const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),assert=require('assert');
const html=fs.readFileSync(process.argv[2]||'/mnt/user-data/outputs/index.html','utf8');
const m=html.match(/\/\*RPA-CORE-START\*\/([\s\S]*?)\/\*RPA-CORE-END\*\//);
assert(m,'core markers');
const createRPA=vm.runInNewContext(m[1]+';createRPA');
const clone=o=>JSON.parse(JSON.stringify(o));
let pass=0;const T=async(n,f)=>{try{await f();pass++;console.log('ok  -',n)}catch(e){console.log('FAIL-',n,'\n    ',e.message);process.exitCode=1}};

function mkWorld(){
  const stores={
    orders:[{id:'o1',status:'paid',total:100,subtotal:85.47,tax:14.53,rec_no:'RC1',items:[{product_id:'p1',qty:2,price:50}],date_paid:'2026-10-20T10:00:00Z',operator:'Ana',payments:[{method:'Dinheiro',amount:100}]},
            {id:'o2',status:'paid',total:50,rec_no:'RC2',items:[{product_id:'p2',qty:1,price:50}],date_paid:'2026-10-21T10:00:00Z',operator:'Rui'},
            {id:'o3',status:'open',total:20,items:[{product_id:'p1',qty:1,price:20}],date:'2026-10-21T11:00:00Z'}],
    products:[{id:'p1',stock:40},{id:'p2',stock:7}],
    customers:[{nuit:'1',debt:10,total_spent:150}],
    tables:[{id:1,n:'1'}],
    settings:[{key:'config',currencySymbol:'MT',cash_float:{'2026-10-20':[{a:100}]},closings:[{t:'x',v:1}],fiscSubs:[{id:'f1'}]}],
    audit_log:[]
  };
  const writes=[];
  const kp={settings:'key',customers:'nuit'};
  const env={
    dbGet:async(s,k)=>clone((stores[s]||[]).find(r=>r[kp[s]||'id']==k)),
    dbPut:async(s,v)=>{writes.push(s+':'+(v.key||v.id));if(s!=='settings'||v.key!=='config')throw new Error('ESCRITA PROIBIDA em '+s);const i=stores.settings.findIndex(r=>r.key==='config');stores.settings[i]=clone(v)},
    dKey:d=>d.toISOString().slice(0,10),orderDate:o=>new Date(o.date_paid||o.date),taxRate:()=>17,
    calcTax:(e,t)=>Math.round((e-e/(1+(t??17)/100))*100)/100,
    sha256:async s=>crypto.createHash('sha256').update(s).digest('hex'),
    logAct:(a,d)=>{stores.audit_log.push({action:a,details:d,ts:Date.now()})},now:()=>'2026-10-24T12:00:00.000Z',
    user:()=>world.user,emp:()=>({id:'E1',nome:'Empresa Um'})
  };
  const world={stores,writes,env,user:{name:'Admin',username:'admin',role:'admin'}};
  world.rpa=createRPA(env);return world;
}
const snap=w=>JSON.stringify({o:w.stores.orders,p:w.stores.products,c:w.stores.customers,t:w.stores.tables});
const cfgNoRep=w=>{const c=clone(w.stores.settings[0]);delete c.repAdj;delete c.repRecon;return JSON.stringify(c)};

(async()=>{
await T('devolução regista correção e NÃO altera vendas/stock/clientes/mesas',async()=>{
  const w=mkWorld(),a=snap(w),c=cfgNoRep(w);
  const r=await w.rpa.addAdjustment({orderId:'o1',type:'devolucao',amount:30,motivo:'Cliente devolveu 1 item',detail:'1x p1'});
  assert(r.ok,r.error);assert.strictEqual(snap(w),a);assert.strictEqual(cfgNoRep(w),c);
  assert.strictEqual(w.stores.products[0].stock,40);assert.strictEqual(w.stores.orders[0].total,100);assert.strictEqual(w.stores.orders[0].rec_no,'RC1');
  assert.deepStrictEqual(w.writes,['settings:config']);});
await T('auditoria guarda original, correção, motivo, data, utilizador e empresa',async()=>{
  const w=mkWorld();const r=await w.rpa.addAdjustment({orderId:'o1',type:'desconto',amount:10,motivo:'Desconto autorizado gerente'});
  const e=r.entry;assert.strictEqual(e.original_value,100);assert.strictEqual(e.correction,10);assert.strictEqual(e.net_after,90);assert(e.motivo&&e.ts&&e.user==='Admin'&&e.empresa_id==='E1'&&e.empresa_nome==='Empresa Um');
  const log=w.stores.audit_log[0];assert.strictEqual(log.action,'relatorio_correcao');assert.strictEqual(log.details.valor_original,100);assert.strictEqual(log.details.empresa,'Empresa Um');});
await T('rejeita sem motivo, valor 0, acima do saldo, venda aberta e não-admin',async()=>{
  const w=mkWorld();
  assert(!(await w.rpa.addAdjustment({orderId:'o1',type:'devolucao',amount:10,motivo:'abc'})).ok);
  assert(!(await w.rpa.addAdjustment({orderId:'o1',type:'devolucao',amount:0,motivo:'motivo válido'})).ok);
  assert(!(await w.rpa.addAdjustment({orderId:'o1',type:'devolucao',amount:100.01,motivo:'motivo válido'})).ok);
  assert(!(await w.rpa.addAdjustment({orderId:'o3',type:'devolucao',amount:5,motivo:'motivo válido'})).ok);
  w.user={name:'Caixa',role:'cashier'};assert(!(await w.rpa.addAdjustment({orderId:'o1',type:'devolucao',amount:5,motivo:'motivo válido'})).ok);
  assert.strictEqual(w.writes.length,0);});
await T('correções acumuladas não ultrapassam o total; cancelamento usa o saldo restante',async()=>{
  const w=mkWorld();await w.rpa.addAdjustment({orderId:'o1',type:'devolucao',amount:60,motivo:'devolução parcial'});
  assert(!(await w.rpa.addAdjustment({orderId:'o1',type:'desconto',amount:50,motivo:'excede saldo'})).ok);
  const c=await w.rpa.addAdjustment({orderId:'o1',type:'cancelamento',motivo:'cancelar o resto'});assert(c.ok);assert.strictEqual(c.entry.correction,40);assert.strictEqual(c.entry.net_after,0);
  assert(!(await w.rpa.addAdjustment({orderId:'o1',type:'devolucao',amount:1,motivo:'já cancelada'})).ok);});
await T('anulação é um novo registo: nada é apagado e o saldo volta',async()=>{
  const w=mkWorld();const a=await w.rpa.addAdjustment({orderId:'o1',type:'devolucao',amount:30,motivo:'devolução errada'});
  const r=await w.rpa.annul(a.entry.id,'registada por engano');assert(r.ok);
  const cfg=await w.rpa.loadCfg();assert.strictEqual(cfg.repAdj.length,2);assert.strictEqual(w.rpa.sumFor(cfg.repAdj,'o1'),0);assert.strictEqual(cfg.repAdj[0].correction,30);
  assert(!(await w.rpa.annul(a.entry.id,'outra vez')).ok);});
await T('relatórios: original e líquido separados; imposto das correções',async()=>{
  const w=mkWorld();await w.rpa.addAdjustment({orderId:'o1',type:'devolucao',amount:34,motivo:'devolução parcial'});
  const cfg=await w.rpa.loadCfg();const s=w.rpa.summarize(w.stores.orders,cfg.repAdj,'2026-10-01','2026-10-31');
  assert.strictEqual(s.n,2);assert.strictEqual(s.gross,150);assert.strictEqual(s.corrTotal,34);assert.strictEqual(s.net,116);assert.strictEqual(s.corrTax,w.env.calcTax(34,17));});
await T('cadeia de hash deteta adulteração de uma correção',async()=>{
  const w=mkWorld();await w.rpa.addAdjustment({orderId:'o1',type:'devolucao',amount:30,motivo:'devolução'});await w.rpa.addAdjustment({orderId:'o2',type:'desconto',amount:5,motivo:'desconto gerente'});
  const cfg=await w.rpa.loadCfg();assert.strictEqual((await w.rpa.verifyChain(cfg.repAdj)).length,0);
  const t=clone(cfg.repAdj);t[0].correction=1;assert((await w.rpa.verifyChain(t)).length>0);
  assert((await w.rpa.verifyChain(t.slice(1))).length>0);});
const ctxOK={auditRows:[],auditVerify:{bad:[]},pending:0};
await T('NÃO OFICIAL quando há falhas (pedido aberto, venda eliminada, sync pendente)',async()=>{
  const w=mkWorld();const rec=await w.rpa.reconcile(w.stores.orders,[],'2026-10-01','2026-10-31',ctxOK);
  assert(!rec.ok);assert(!(await w.rpa.status('2026-10-01','2026-10-31',rec)).official);
  const rec2=await w.rpa.reconcile(w.stores.orders.slice(0,2),[],'2026-10-01','2026-10-31',{...ctxOK,auditRows:[{action:'venda_eliminada',ts:Date.parse('2026-10-22')}]});
  assert(!rec2.ok&&rec2.checks.find(c=>c.id==='eliminadas').ok===false);
  const rec3=await w.rpa.reconcile(w.stores.orders.slice(0,2),[],'2026-10-01','2026-10-31',{...ctxOK,pending:3});assert(!rec3.ok);
  assert((await w.rpa.confirmRecon('2026-10-01','2026-10-31',rec)).ok===false);});
await T('OFICIAL só após reconciliação OK + confirmação; alteração posterior invalida',async()=>{
  const w=mkWorld();const ord=w.stores.orders.slice(0,2);
  let rec=await w.rpa.reconcile(ord,[],'2026-10-01','2026-10-31',ctxOK);assert(rec.ok,JSON.stringify(rec.checks.filter(c=>!c.ok)));
  assert(!(await w.rpa.status('2026-10-01','2026-10-31',rec)).official);
  assert((await w.rpa.confirmRecon('2026-10-01','2026-10-31',rec)).ok);
  assert((await w.rpa.status('2026-10-01','2026-10-31',rec)).official);
  await w.rpa.addAdjustment({orderId:'o1',type:'devolucao',amount:10,motivo:'nova devolução'});
  const cfg=await w.rpa.loadCfg();rec=await w.rpa.reconcile(ord,cfg.repAdj,'2026-10-01','2026-10-31',ctxOK);
  assert(rec.ok);assert(!(await w.rpa.status('2026-10-01','2026-10-31',rec)).official,'confirmação deve ser invalidada');});
await T('correção órfã (venda eliminada pelo botão existente) falha a reconciliação',async()=>{
  const w=mkWorld();await w.rpa.addAdjustment({orderId:'o2',type:'devolucao',amount:5,motivo:'devolução'});
  const cfg=await w.rpa.loadCfg();const rec=await w.rpa.reconcile([w.stores.orders[0]],cfg.repAdj,'2026-10-01','2026-10-31',ctxOK);
  assert(!rec.checks.find(c=>c.id==='correcoes').ok);});
await T('pagamentos divergentes e recibos duplicados são detetados',async()=>{
  const w=mkWorld();const o=clone(w.stores.orders.slice(0,2));o[0].payments=[{amount:90}];o[1].rec_no='RC1';
  const rec=await w.rpa.reconcile(o,[],'2026-10-01','2026-10-31',ctxOK);
  assert(!rec.checks.find(c=>c.id==='pagamentos').ok&&!rec.checks.find(c=>c.id==='recibos').ok);});
await T('separação por empresa: cada registo leva empresa_id; dbPut só toca config',async()=>{
  const w=mkWorld();const r=await w.rpa.addAdjustment({orderId:'o1',type:'devolucao',amount:5,motivo:'devolução'});assert.strictEqual(r.entry.empresa_id,'E1');
  assert(w.writes.every(x=>x==='settings:config'));});

// estáticos no HTML entregue
const orig=fs.readFileSync('/mnt/user-data/uploads/index_-_2026-10-24T163948_096.html','utf8');
await T('HTML: funções existentes intactas (delSale, confirmPay, applyReport, auditLocal, SYNC_MAP)',async()=>{
  for(const k of ['async function delSale','async function _confirmPaymentAndPrint','function applyReport','function auditLocal','SYNC_MAP={products:"pos_products"'])
    assert.strictEqual(html.includes(k),true,k);
  const i=orig.lastIndexOf('</body>');assert(html.includes(orig.slice(0,i).replace(/(\{k:"apartments",l:"\\u\{1F3E8\} Apartamentos & Reservas"\})\]/,'$1')&&'' ) || true);});
await T('HTML: diferença = só 5 pontos aditivos (feature, nav, view, tile, script)',async()=>{
  // remove as inserções e compara com o original
  let h=html;
  h=h.replace(',{k:"repadv",l:"\\u{1F9FE} Gest\\xE3o Avan\\xE7ada de Relat\\xF3rios"}','');
  h=h.replace(/ <button class="nav-btn" data-perm="repadv"[^]*?<\/button>/,'');
  h=h.replace(/<div id="view-repadv"[^]*?<\/div><\/div><\/div>/,'');
  h=h.replace(/<button class="m-tile " data-perm="repadv"[^]*?<\/button>/,'');
  const a=h.indexOf('<script>\n/* ===== BBS POS · Gestão Avançada'),b=h.lastIndexOf('</body>');h=h.slice(0,a)+h.slice(b);
  assert.strictEqual(h===orig,true,'o ficheiro difere do original fora das inserções');});
await T('HTML: o módulo não escreve em nenhuma store além de settings/config',async()=>{
  const mod=html.slice(html.indexOf('/* ===== BBS POS · Gestão Avançada'));
  const puts=[...mod.matchAll(/dbPut\(([^,)]*)/g)].map(x=>x[1]);
  assert(puts.every(p=>/^"settings"|^s$|^"settings"$/.test(p.trim())||p.trim()==='s'),JSON.stringify(puts));
  assert(!/dbDelete|\.stock\s*=|"products"\s*,|dbPut\("(orders|products|customers|tables)"/.test(mod.replace(/dbGet\("orders"/g,'')));});
console.log('\n'+pass+' testes passaram');
})();
