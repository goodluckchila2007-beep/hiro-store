'use strict';
module.exports = function registerHiroAdminModules({ app, db, requireAdmin, finance, getSetting, setSetting }) {
  db.exec("CREATE TABLE IF NOT EXISTS admin_activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, admin_email TEXT, action TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_admin_activity_created ON admin_activity_log(created_at DESC);");
  app.use('/api/admin/modules', (req,res,next) => requireAdmin(req,res,() => {
    try {
      const a=db.prepare("SELECT email FROM users WHERE id=? AND role='admin'").get(req.session.userId);
      db.prepare("INSERT INTO admin_activity_log(admin_id,admin_email,action,method,path,created_at) VALUES(?,?,?,?,?,?)").run(req.session.userId,a?.email||'',req.method+' '+req.path,req.method,req.path,new Date().toISOString());
    } catch(e) { console.error('Admin audit write:',e.message); }
    next();
  }));
  const daysOf=v=>{const n=Number(v||30);return Number.isInteger(n)&&n>=7&&n<=365?n:30;};
  app.get('/api/admin/modules/analytics',requireAdmin,(req,res)=>{
    try {
      const days=daysOf(req.query.days),cutoff=new Date(Date.now()-days*86400000).toISOString();
      const daily=db.prepare("SELECT date(COALESCE(paid_at,created_at)) day,COUNT(*) orders,ROUND(SUM(amount_charged)/100.0,2) revenue FROM orders WHERE amount_charged>0 AND status NOT IN ('Refunded','Cancelled','Failed') AND datetime(COALESCE(paid_at,created_at))>=datetime(?) GROUP BY date(COALESCE(paid_at,created_at)) ORDER BY day").all(cutoff);
      const topProducts=db.prepare("SELECT oi.title,SUM(oi.quantity) units,ROUND(SUM(oi.price*oi.quantity),2) sales FROM order_items oi JOIN orders o ON o.order_id=oi.order_id WHERE o.amount_charged>0 AND o.status NOT IN ('Refunded','Cancelled','Failed') AND datetime(COALESCE(o.paid_at,o.created_at))>=datetime(?) GROUP BY oi.title ORDER BY units DESC LIMIT 10").all(cutoff);
      const categories=db.prepare("SELECT oi.category_id category,SUM(oi.quantity) units,ROUND(SUM(oi.price*oi.quantity),2) sales FROM order_items oi JOIN orders o ON o.order_id=oi.order_id WHERE o.amount_charged>0 AND o.status NOT IN ('Refunded','Cancelled','Failed') AND datetime(COALESCE(o.paid_at,o.created_at))>=datetime(?) GROUP BY oi.category_id ORDER BY sales DESC LIMIT 12").all(cutoff);
      const summary=db.prepare("SELECT COUNT(*) orders,ROUND(COALESCE(SUM(amount_charged),0)/100.0,2) revenue,COUNT(DISTINCT user_id) customers FROM orders WHERE datetime(COALESCE(paid_at,created_at))>=datetime(?)").get(cutoff);
      const returning=db.prepare("SELECT COUNT(*) count FROM (SELECT user_id FROM orders WHERE user_id IS NOT NULL AND amount_charged>0 AND status NOT IN ('Refunded','Cancelled','Failed') GROUP BY user_id HAVING COUNT(*)>1)").get();
      const profit=finance.overview(days<=7?'7':days<=30?'30':'all');
      res.json({success:true,days,summary:{...summary,returningCustomers:returning.count||0},daily,topProducts,categories,profit});
    } catch(e) { console.error('Advanced analytics:',e.message);res.status(500).json({success:false,message:'Unable to load advanced analytics.'}); }
  });
  app.get('/api/admin/modules/inventory',requireAdmin,(req,res)=>{
    try {
      const products=db.prepare("SELECT id,category_id categoryId,offer_id offerId,title,supplier_price_usd supplierPriceUsd,retail_price_ngn retailPriceNgn,available,supplier_synced_at supplierSyncedAt,updated_at updatedAt FROM products ORDER BY category_id,title").all();
      const stale=Date.now()-86400000;
      const stats={total:products.length,active:products.filter(p=>p.available&&Number(p.retailPriceNgn)>0).length,unavailable:products.filter(p=>!p.available).length,missingSellingPrice:products.filter(p=>Number(p.retailPriceNgn)<=0).length,staleSupplierData:products.filter(p=>!p.supplierSyncedAt||Date.parse(p.supplierSyncedAt)<stale).length};
      res.json({success:true,stats,products});
    } catch(e) {console.error('Inventory:',e.message);res.status(500).json({success:false,message:'Unable to load inventory intelligence.'});}
  });
  app.get('/api/admin/modules/finance',requireAdmin,(req,res)=>{
    try {
      const summary=db.prepare("SELECT COUNT(*) totalOrders,ROUND(COALESCE(SUM(CASE WHEN amount_charged>0 AND status NOT IN ('Refunded','Cancelled','Failed') THEN amount_charged ELSE 0 END),0)/100.0,2) capturedRevenue,ROUND(COALESCE(SUM(CASE WHEN status='Refunded' THEN amount_charged ELSE 0 END),0)/100.0,2) refundedValue,ROUND(COALESCE(SUM(paystack_fee_kobo),0)/100.0,2) recordedFees,SUM(CASE WHEN amount_charged>0 AND status NOT IN ('Refunded','Cancelled','Failed') AND paystack_fee_kobo IS NULL THEN 1 ELSE 0 END) missingFees FROM orders").get();
      const unmatched=db.prepare("SELECT COUNT(*) count,ROUND(COALESCE(SUM(amount),0)/100.0,2) value FROM unmatched_payments WHERE resolution_status='Unresolved'").get();
      const supplier=db.prepare("SELECT COUNT(*) items,SUM(CASE WHEN supplier_cost_ngn<=0 THEN 1 ELSE 0 END) missingCostLines FROM order_items").get();
      const recent=db.prepare("SELECT order_id orderId,reference,email,currency,amount_charged amountChargedKobo,paystack_fee_kobo feeKobo,paystack_fee_source feeSource,status,paid_at paidAt FROM orders ORDER BY id DESC LIMIT 30").all();
      res.json({success:true,summary,unmatched,supplier,recent});
    } catch(e) {console.error('Finance centre:',e.message);res.status(500).json({success:false,message:'Unable to load finance and audit centre.'});}
  });
  app.get('/api/admin/modules/crm',requireAdmin,(req,res)=>{
    try {
      const customers=db.prepare("SELECT u.id,u.name,u.email,u.phone,u.email_verified emailVerified,u.created_at joinedAt,COUNT(o.id) orderCount,ROUND(COALESCE(SUM(CASE WHEN o.amount_charged>0 AND o.status NOT IN ('Refunded','Cancelled','Failed') THEN o.amount_charged ELSE 0 END),0)/100.0,2) lifetimeSpend,MAX(o.created_at) lastOrderAt FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.role='customer' GROUP BY u.id ORDER BY lifetimeSpend DESC,u.created_at DESC LIMIT 250").all();
      const summary=db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN email_verified=1 THEN 1 ELSE 0 END) verified FROM users WHERE role='customer'").get();
      res.json({success:true,summary,customers});
    } catch(e) {console.error('CRM:',e.message);res.status(500).json({success:false,message:'Unable to load customer CRM.'});}
  });
  app.get('/api/admin/modules/marketing',requireAdmin,(req,res)=>{
    try {
      const coupons=db.prepare("SELECT c.id,c.code,c.discount_type discountType,c.discount_value discountValue,c.active,c.starts_at startsAt,c.ends_at endsAt,COUNT(cr.id) redemptions,ROUND(COALESCE(SUM(CASE WHEN cr.status='used' THEN cr.discount_ngn ELSE 0 END),0),2) discountSpend FROM coupons c LEFT JOIN coupon_redemptions cr ON cr.coupon_id=c.id GROUP BY c.id ORDER BY c.created_at DESC").all();
      const summary={campaigns:coupons.length,active:coupons.filter(c=>c.active).length,redemptions:coupons.reduce((n,c)=>n+Number(c.redemptions||0),0),discountSpend:coupons.reduce((n,c)=>n+Number(c.discountSpend||0),0)};
      res.json({success:true,summary,coupons,announcement:getSetting('store_announcement','')});
    } catch(e) {console.error('Marketing:',e.message);res.status(500).json({success:false,message:'Unable to load marketing centre.'});}
  });
  app.patch('/api/admin/modules/marketing/announcement',requireAdmin,(req,res)=>{
    const announcement=String(req.body?.announcement||'').trim().slice(0,300);setSetting('store_announcement',announcement);res.json({success:true,announcement});
  });
  app.get('/api/admin/modules/security',requireAdmin,(req,res)=>{
    try {
      const admins=db.prepare("SELECT id,name,email,created_at createdAt FROM users WHERE role='admin' ORDER BY id").all();
      const events=db.prepare("SELECT admin_email adminEmail,action,method,path,created_at createdAt FROM admin_activity_log ORDER BY id DESC LIMIT 100").all();
      res.json({success:true,admins,events,policy:{adminCount:admins.length,note:'Audit entries are recorded for use of these admin modules. This is not a full login/session history.'}});
    } catch(e) {console.error('Security:',e.message);res.status(500).json({success:false,message:'Unable to load admin security centre.'});}
  });
  async function fzrGet(endpoint) {
    if(!process.env.FZR_API_KEY){const e=new Error('FZR_API_KEY is not configured on the server.');e.status=503;throw e;}
    const c=new AbortController(),timer=setTimeout(()=>c.abort(),10000);
    try {
      const r=await fetch('https://api.fzr.cards/api/v2'+endpoint,{headers:{Accept:'application/json','X-API-Key':process.env.FZR_API_KEY},signal:c.signal});
      const raw=await r.text();let d;try{d=raw?JSON.parse(raw):{};}catch{throw new Error('FZR returned an unreadable response.');}
      if(!r.ok||d.ok!==true){const e=new Error(d.error||d.message||('FZR request failed: HTTP '+r.status));e.status=r.status;throw e;}return d;
    } finally {clearTimeout(timer);}
  }
  app.get('/api/admin/modules/fzr',requireAdmin,async(req,res)=>{
    try {
      const pair=await Promise.all([fzrGet('/balance'),fzrGet('/transactions?page=1&limit=30').catch(e=>({error:e.message,items:[]}))]);
      const b=pair[0],t=pair[1],threshold=Number(getSetting('fzr_low_balance_threshold_usd','10'));
      res.json({success:true,balance:Number(b.balance),currency:b.currency||'USD',threshold,lowBalance:Number(b.balance)<=threshold,transactions:Array.isArray(t.items)?t.items:[],transactionsWarning:t.error||null,checkedAt:new Date().toISOString()});
    } catch(e) {res.status(e.status||502).json({success:false,message:e.message||'Unable to retrieve FZR balance.'});}
  });
  app.patch('/api/admin/modules/fzr/threshold',requireAdmin,(req,res)=>{
    const n=Number(req.body?.threshold);if(!Number.isFinite(n)||n<0||n>1000000)return res.status(400).json({success:false,message:'Enter a valid USD alert threshold.'});
    setSetting('fzr_low_balance_threshold_usd',String(n));res.json({success:true,threshold:n});
  });
};
