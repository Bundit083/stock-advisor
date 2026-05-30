import { useState, useEffect, useCallback } from "react";

const ASSETS = [
  { symbol:"PTT.BK",    display:"PTT",        name:"ปตท.",             sector:"พลังงาน",    type:"stock" },
  { symbol:"ADVANC.BK", display:"ADVANC",     name:"แอดวานซ์ อินโฟ",  sector:"โทรคมนาคม", type:"stock" },
  { symbol:"AOT.BK",    display:"AOT",        name:"ท่าอากาศยานไทย",   sector:"ขนส่ง",     type:"stock" },
  { symbol:"KBANK.BK",  display:"KBANK",      name:"กสิกรไทย",         sector:"ธนาคาร",    type:"stock" },
  { symbol:"SCB.BK",    display:"SCB",        name:"ไทยพาณิชย์",       sector:"ธนาคาร",    type:"stock" },
  { symbol:"CPALL.BK",  display:"CPALL",      name:"ซีพี ออลล์",       sector:"ค้าปลีก",   type:"stock" },
  { symbol:"SCC.BK",    display:"SCC",        name:"ปูนซิเมนต์ไทย",    sector:"อุตสาหกรรม",type:"stock" },
  { symbol:"MINT.BK",   display:"MINT",       name:"ไมเนอร์ อินเตอร์", sector:"ท่องเที่ยว",type:"stock" },
  { symbol:"GC=F",      display:"ทอง SPOT",   name:"Gold Futures",     sector:"ทองคำ",     type:"gold"  },
  { symbol:"THB=X",     display:"USD/THB",    name:"ค่าเงินบาท",       sector:"ค่าเงิน",   type:"fx"    },
];

// Yahoo Finance โดยตรง — ใช้ได้เพราะ deploy บน domain ของเราเอง ไม่ถูก block CORS
async function fetchYahoo(symbol) {
  try {
    const url = `/api/yahoo/${symbol}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const result = raw?.chart?.result?.[0];
    if (!result) throw new Error("no result");
    const meta = result.meta;
    const q = result.indicators?.quote?.[0] || {};
    const closes  = (q.close  || []).map((v,i) => v ?? null);
    const highs   = (q.high   || []);
    const lows    = (q.low    || []);
    const volumes = (q.volume || []);
    const validIdx = closes.map((c,i) => c !== null ? i : -1).filter(i => i >= 0);
    const history = validIdx.map(i => ({
      close:  closes[i],
      high:   highs[i]   || closes[i] * 1.005,
      low:    lows[i]    || closes[i] * 0.995,
      volume: volumes[i] || 0,
    }));
    const currentPrice = meta.regularMarketPrice || history[history.length-1]?.close || 0;
    const prevClose    = meta.chartPreviousClose  || history[history.length-2]?.close || currentPrice;
    const change    = currentPrice - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;
    return { ok:true, currentPrice, change, changePct, history, currency: meta.currency || "THB" };
  } catch(e) {
    return { ok:false, error: e.message };
  }
}

// Indicators
function ema(arr, n) {
  if (arr.length < n) return arr[arr.length-1] || 0;
  const k = 2/(n+1); let e = arr.slice(0,n).reduce((a,b)=>a+b,0)/n;
  for (let i=n; i<arr.length; i++) e = arr[i]*k + e*(1-k);
  return e;
}
function calcRSI(hist) {
  const c = hist.slice(-15).map(d=>d.close); if (c.length<2) return 50;
  let g=0,l=0; for (let i=1;i<c.length;i++){const d=c[i]-c[i-1];d>0?g+=d:l-=d;}
  const ag=g/14,al=l/14; return al===0?100:Math.round(100-100/(1+ag/al));
}
function calcMACD(hist) {
  const c = hist.map(d=>d.close); if (c.length<26) return {ml:0,sl:0,hist:0};
  const ml=ema(c,12)-ema(c,26),sl=ml*0.9; return {ml,sl,hist:ml-sl};
}
function calcBB(hist) {
  const c = hist.slice(-20).map(d=>d.close); if (c.length<2) return {upper:0,mid:0,lower:0};
  const m=c.reduce((a,b)=>a+b,0)/c.length;
  const s=Math.sqrt(c.reduce((sum,x)=>sum+Math.pow(x-m,2),0)/c.length);
  return {upper:m+2*s,mid:m,lower:m-2*s};
}
function calcSMA(hist, n) { const c=hist.slice(-n).map(d=>d.close); return c.length?c.reduce((a,b)=>a+b,0)/c.length:0; }

function analyze(hist, cur) {
  if (!hist?.length || hist.length<5) return null;
  const RSI=calcRSI(hist), MACD=calcMACD(hist), BB=calcBB(hist);
  const SMA20=calcSMA(hist,20), SMA50=calcSMA(hist,Math.min(50,hist.length));
  const prev = hist[hist.length-2]?.close || cur;
  const chgPct = ((cur-prev)/prev)*100;
  let score=0, reasons=[], warnings=[];
  if(RSI<30){score+=2;reasons.push(`RSI ${RSI} — Oversold`);}
  else if(RSI<45){score+=1;reasons.push(`RSI ${RSI} — โซนน่าสนใจ`);}
  else if(RSI>70){score-=2;warnings.push(`RSI ${RSI} — Overbought`);}
  else if(RSI>60){score-=1;warnings.push(`RSI ${RSI} — แรงซื้อสูง`);}
  if(MACD.hist>0&&MACD.ml>MACD.sl){score+=2;reasons.push("MACD Cross ขาขึ้น");}
  else if(MACD.hist<0){score-=1;warnings.push("MACD เป็นลบ");}
  if(cur<BB.lower){score+=2;reasons.push("ราคาต่ำกว่า Bollinger Lower");}
  else if(BB.upper>0&&cur>BB.upper){score-=2;warnings.push("ราคาสูงกว่า Bollinger Upper");}
  if(SMA20>SMA50&&SMA50>0){score+=1;reasons.push("SMA20>SMA50 เทรนด์ขึ้น");}
  else if(SMA50>0){score-=1;warnings.push("SMA20<SMA50 เทรนด์ลง");}
  if(chgPct>1.2){score+=1;reasons.push(`ราคา +${chgPct.toFixed(2)}%`);}
  else if(chgPct<-1.2){score-=1;warnings.push(`ราคา ${chgPct.toFixed(2)}%`);}
  const safeU=BB.upper>cur?BB.upper:cur*1.05, safeL=BB.lower>0&&BB.lower<cur?BB.lower:cur*0.97;
  let signal,buyAt,sellAt,stopLoss,timing,holdUntil;
  if(score>=4){signal="STRONG_BUY";buyAt=cur;sellAt=safeU*1.01;stopLoss=cur*0.963;timing="ซื้อได้เลย สัญญาณแข็งแกร่ง";holdUntil="2–4 สัปดาห์";}
  else if(score>=2){signal="BUY";buyAt=safeL*1.003;sellAt=safeU;stopLoss=cur*0.968;timing="รอราคาย่อมาแนวรับก่อน";holdUntil="1–3 สัปดาห์";}
  else if(score<=-4){signal="STRONG_SELL";buyAt=safeL*0.97;sellAt=cur;stopLoss=cur*1.03;timing="ขายได้เลย";holdUntil="ขายทันที";}
  else if(score<=-2){signal="SELL";buyAt=safeL*0.98;sellAt=cur;stopLoss=cur*1.025;timing="ขายถ้าไม่ผ่านแนวต้าน";holdUntil="1–2 สัปดาห์";}
  else{signal="HOLD";buyAt=safeL;sellAt=safeU;stopLoss=cur*0.965;timing="ถือต่อ รอสัญญาณชัดขึ้น";holdUntil="ติดตามต่อ";}
  const trend=score>=2?1:score<=-2?-1:0, vol=Math.abs(chgPct)*0.002+0.001;
  const hrs=["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:30"];
  let p=cur;
  const prediction=hrs.map((t,i)=>{p=p*(1+trend*vol*0.5+(Math.sin(i*1.1)*vol*0.25));return{t,p};});
  return{signal,score,RSI,MACD,BB,SMA20,SMA50,buyAt,sellAt,stopLoss,timing,holdUntil,support:safeL,resistance:safeU,reasons,warnings,prediction};
}

const SIG={
  STRONG_BUY:{emoji:"🟢",label:"ซื้อแนะนำ!",color:"#00e676",bg:"#00e67612",border:"#00e67650"},
  BUY:       {emoji:"🔼",label:"ซื้อ",       color:"#69f0ae",bg:"#69f0ae0e",border:"#69f0ae40"},
  HOLD:      {emoji:"⏸", label:"ถือ",        color:"#ffd740",bg:"#ffd7400e",border:"#ffd74040"},
  SELL:      {emoji:"🔽",label:"ขาย",        color:"#ff6b6b",bg:"#ff6b6b0e",border:"#ff6b6b40"},
  STRONG_SELL:{emoji:"🔴",label:"ขายด่วน!", color:"#ff1744",bg:"#ff174412",border:"#ff174450"},
};

function Chart({hist,an,isGold}){
  if(!hist?.length||!an) return null;
  const W=500,H=110,prices=hist.map(d=>d.close),pred=an.prediction?.map(p=>p.p)||[];
  const allP=[...prices,...pred,an.buyAt,an.sellAt].filter(Boolean);
  const mn=Math.min(...allP)*0.997,mx=Math.max(...allP)*1.003;
  const ty=p=>H-((p-mn)/(mx-mn||1))*(H-8)-4;
  const hPts=prices.map((p,i)=>`${(i/(prices.length-1))*(W*.65)},${ty(p)}`).join(" ");
  const pX=W*.65,pPts=pred.map((p,i)=>`${pX+(i/(pred.length-1))*(W*.35)},${ty(p)}`).join(" ");
  const lc=isGold?"#f5c842":(prices[prices.length-1]>=prices[0]?"#00e676":"#ff4455");
  const by=ty(an.buyAt),sy=ty(an.sellAt),spY=ty(an.support),rsY=ty(an.resistance);
  return(
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
      <defs>
        <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={lc} stopOpacity=".18"/><stop offset="100%" stopColor={lc} stopOpacity="0"/></linearGradient>
        <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity=".18"/><stop offset="100%" stopColor="#a78bfa" stopOpacity="0"/></linearGradient>
      </defs>
      {[.2,.4,.6,.8].map(f=><line key={f} x1={0} y1={H*f} x2={W} y2={H*f} stroke="#ffffff06" strokeWidth="1"/>)}
      <line x1={pX} y1={0} x2={pX} y2={H} stroke="#ffffff12" strokeWidth="1" strokeDasharray="3,3"/>
      <text x={pX+4} y={10} fill="#444" fontSize="8" fontFamily="monospace">▶ วันนี้</text>
      {spY>4&&spY<H&&<line x1={0} y1={spY} x2={W} y2={spY} stroke="#00e676" strokeWidth="1" strokeDasharray="4,3" opacity=".4"/>}
      {rsY>4&&rsY<H&&<line x1={0} y1={rsY} x2={W} y2={rsY} stroke="#ff6b6b" strokeWidth="1" strokeDasharray="4,3" opacity=".4"/>}
      {by>4&&by<H&&<line x1={0} y1={by} x2={W*.6} y2={by} stroke="#00e676" strokeWidth="1.5" opacity=".65"/>}
      {sy>4&&sy<H&&<line x1={0} y1={sy} x2={W*.6} y2={sy} stroke="#ff6b6b" strokeWidth="1.5" opacity=".65"/>}
      <polygon fill="url(#hg)" points={`0,${H} ${hPts} ${W*.65},${H}`}/>
      <polyline fill="none" stroke={lc} strokeWidth="2" points={hPts} strokeLinejoin="round"/>
      {pred.length>1&&<><polygon fill="url(#pg)" points={`${pX},${H} ${pPts} ${W},${H}`}/><polyline fill="none" stroke="#a78bfa" strokeWidth="1.8" strokeDasharray="6,3" points={pPts} strokeLinejoin="round"/><circle cx={W} cy={ty(pred[pred.length-1])} r="3" fill="#a78bfa"/></>}
      <circle cx={W*.65} cy={ty(prices[prices.length-1])} r="4" fill={lc}/>
      <circle cx={W*.65} cy={ty(prices[prices.length-1])} r="8" fill={lc} fillOpacity=".12"/>
    </svg>
  );
}
function Spark({hist,color}){
  if(!hist?.length) return <div style={{height:22,width:80}}/>;
  const W=80,H=22,pr=hist.slice(-15).map(d=>d.close);
  const mn=Math.min(...pr),mx=Math.max(...pr);
  const pts=pr.map((p,i)=>`${(i/(pr.length-1))*W},${H-((p-mn)/(mx-mn||1))*H}`).join(" ");
  return <svg width={W} height={H} style={{display:"block"}}><polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} strokeLinejoin="round"/></svg>;
}

export default function App(){
  const [data,setData]=useState({});
  const [sel,setSel]=useState(ASSETS[0]);
  const [tab,setTab]=useState("stock");
  const [refreshing,setRefreshing]=useState(false);
  const [lastRefresh,setLastRefresh]=useState(null);
  const [prog,setProg]=useState({done:0,total:0});

  const loadOne=useCallback(async(asset)=>{
    setData(prev=>({...prev,[asset.symbol]:{...prev[asset.symbol],status:"loading"}}));
    const r=await fetchYahoo(asset.symbol);
    if(!r.ok){setData(prev=>({...prev,[asset.symbol]:{status:"error",error:r.error}}));return;}
    let price=r.currentPrice,chg=r.change;
    if(asset.type==="gold"&&r.currency==="USD"){price=r.currentPrice*33.5*0.321507;chg=r.change*33.5*0.321507;}
    const an=analyze(r.history,price);
    setData(prev=>({...prev,[asset.symbol]:{status:"ok",currentPrice:price,change:chg,changePct:r.changePct,history:r.history,analysis:an,fetchedAt:new Date()}}));
  },[]);

  const refreshAll=useCallback(async()=>{
    setRefreshing(true);setLastRefresh(new Date());
    const total=ASSETS.length;setProg({done:0,total});let done=0;
    for(let i=0;i<ASSETS.length;i+=3){
      await Promise.all(ASSETS.slice(i,i+3).map(a=>loadOne(a).then(()=>setProg({done:++done,total}))));
    }
    setRefreshing(false);
  },[loadOne]);

  useEffect(()=>{refreshAll();},[]);

  const handleSel=useCallback((a)=>{setSel(a);if(!data[a.symbol]||data[a.symbol].status==="error")loadOne(a);},[data,loadOne]);
  const handleTab=useCallback((t)=>{setTab(t);const first=ASSETS.find(a=>t==="gold"?a.type!=="stock":a.type==="stock");if(first)handleSel(first);},[handleSel]);

  const cur=data[sel?.symbol];
  const isGold=sel?.type!=="stock";
  const sig=cur?.analysis?.signal?(SIG[cur.analysis.signal]||SIG.HOLD):SIG.HOLD;
  const gc="#f5c842";
  const fp=p=>{if(p==null)return"—";if(sel?.type==="fx")return`฿${(+p).toFixed(4)}`;if(isGold)return`฿${Math.round(p).toLocaleString()}`;return`฿${(+p).toFixed(2)}`;};

  return(
    <div style={{minHeight:"100vh",background:"#080c10",fontFamily:"'Sarabun',sans-serif",color:"#ccd",display:"flex",flexDirection:"column"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;} ::-webkit-scrollbar-thumb{background:#1a2030;}
        @keyframes fu{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pu{0%,100%{opacity:1}50%{opacity:.2}}
        @keyframes sp{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        .sr{transition:background .1s,border-left .1s;cursor:pointer;}.sr:hover{background:#0e1420!important;}
        .rb{transition:all .15s;cursor:pointer;border:none;}.rb:hover{filter:brightness(1.2);transform:translateY(-1px);}
      `}</style>
      <div style={{background:"#0b0f16",borderBottom:"1px solid #131b24",padding:"10px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:15,fontWeight:700,fontFamily:"JetBrains Mono",color:"#ccd"}}>📈 SET+GOLD Advisor</span>
          <span style={{fontSize:9,background:"#0e2a18",border:"1px solid #0e4020",borderRadius:3,padding:"2px 6px",color:"#2a8",fontFamily:"JetBrains Mono"}}>Yahoo Finance · ฟรี 100%</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {refreshing&&<span style={{fontSize:10,color:"#2a8",fontFamily:"JetBrains Mono"}}>{prog.done}/{prog.total}</span>}
          {!refreshing&&lastRefresh&&<span style={{fontSize:10,color:"#334",fontFamily:"JetBrains Mono"}}>{lastRefresh.toLocaleTimeString("th-TH",{timeStyle:"short"})}</span>}
          <button className="rb" onClick={refreshAll} disabled={refreshing} style={{display:"flex",alignItems:"center",gap:5,background:refreshing?"#131b24":"linear-gradient(135deg,#0e5c2e,#00a851)",borderRadius:6,padding:"6px 12px",color:refreshing?"#334":"#fff",fontSize:11,fontWeight:700,fontFamily:"JetBrains Mono"}}>
            <span style={{animation:refreshing?"sp .6s linear infinite":"none",display:"inline-block"}}>⟳</span>
            {refreshing?`${prog.done}/${prog.total}...`:"🔄 Refresh ทุกตัว"}
          </button>
        </div>
      </div>
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        <div style={{width:236,background:"#0b0f16",borderRight:"1px solid #131b24",display:"flex",flexDirection:"column",flexShrink:0,overflowY:"auto"}}>
          <div style={{display:"flex",borderBottom:"1px solid #131b24",flexShrink:0}}>
            {[["stock","📈 SET"],["gold","🥇 ทอง/FX"]].map(([t,lb])=>(
              <button key={t} className="rb" onClick={()=>handleTab(t)} style={{flex:1,padding:"9px 0",fontSize:11,fontWeight:700,background:tab===t?(t==="gold"?"#100e00":"#0c1018"):"transparent",color:tab===t?(t==="gold"?gc:"#9ab"):"#334",borderBottom:`2px solid ${tab===t?(t==="gold"?gc:"#2a8"):"transparent"}`,fontFamily:"JetBrains Mono"}}>{lb}</button>
            ))}
          </div>
          {ASSETS.filter(a=>tab==="gold"?a.type!=="stock":a.type==="stock").map(asset=>{
            const d=data[asset.symbol],sg=d?.analysis?.signal?(SIG[d.analysis.signal]||SIG.HOLD):SIG.HOLD;
            const isAct=sel?.symbol===asset.symbol,gc2=asset.type!=="stock";
            const hasData=d?.status==="ok",isLoading=d?.status==="loading",isErr=d?.status==="error";
            const pc=hasData?(d.changePct>=0?(gc2?gc:"#00e676"):"#ff4455"):"#334";
            return(
              <div key={asset.symbol} className="sr" onClick={()=>handleSel(asset)} style={{padding:"8px 10px",borderBottom:"1px solid #0c111a",background:isAct?(gc2?"#100e00":"#0c1018"):"transparent",borderLeft:`3px solid ${isAct?(gc2?gc:sg.color):"transparent"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{fontSize:12,fontWeight:700,fontFamily:"JetBrains Mono",color:gc2?gc:"#dde"}}>{asset.display}</span>
                    {hasData&&<span style={{fontSize:8,background:sg.bg,color:sg.color,border:`1px solid ${sg.border}`,borderRadius:3,padding:"0 3px",fontFamily:"JetBrains Mono",fontWeight:700}}>{sg.emoji}{sg.label}</span>}
                    {isLoading&&<span style={{fontSize:9,color:"#2a8",animation:"pu .8s infinite"}}>...</span>}
                    {isErr&&<button className="rb" onClick={e=>{e.stopPropagation();loadOne(asset);}} style={{fontSize:8,color:"#ff4455",background:"#1a0008",border:"1px solid #ff174430",borderRadius:3,padding:"0 4px"}}>retry</button>}
                  </div>
                  <span style={{fontSize:11,fontFamily:"JetBrains Mono",color:pc,fontWeight:600}}>{isLoading?"...":hasData?fp(d.currentPrice):"—"}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:hasData?4:0}}>
                  <span style={{fontSize:9,color:"#334"}}>{asset.sector}</span>
                  {hasData&&<span style={{fontSize:10,fontFamily:"JetBrains Mono",fontWeight:600,color:pc}}>{d.changePct>=0?"▲":"▼"}{Math.abs(d.changePct||0).toFixed(2)}%</span>}
                </div>
                {hasData&&d.history?.length>1&&<Spark hist={d.history} color={gc2?gc:(d.changePct>=0?"#00e676":"#ff4455")}/>}
              </div>
            );
          })}
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"14px 18px"}}>
          {cur?.status==="loading"&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:260}}><div style={{fontSize:32,animation:"pu 1s infinite",marginBottom:10}}>📊</div><div style={{color:"#334",fontSize:12,fontFamily:"JetBrains Mono"}}>กำลังดึงราคาจาก Yahoo Finance...</div></div>}
          {cur?.status==="error"&&<div style={{textAlign:"center",padding:"40px 0",color:"#334"}}><div style={{fontSize:28,marginBottom:8}}>⚠️</div><div style={{fontSize:13,marginBottom:4}}>ดึงข้อมูลไม่สำเร็จ</div><div style={{fontSize:10,color:"#223",marginBottom:10}}>{cur.error}</div><button className="rb" onClick={()=>loadOne(sel)} style={{background:"#131b24",border:"1px solid #1e2c3a",borderRadius:6,padding:"7px 16px",color:"#9ab",fontSize:12,fontFamily:"JetBrains Mono"}}>ลองใหม่</button></div>}
          {cur?.status==="ok"&&sel&&cur.analysis&&(
            <div style={{animation:"fu .3s ease"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:2}}>
                    <h1 style={{fontSize:21,fontWeight:700,fontFamily:"JetBrains Mono",color:isGold?gc:"#eef"}}>{sel.display}</h1>
                    <div style={{background:sig.bg,border:`2px solid ${sig.border}`,borderRadius:7,padding:"4px 12px",display:"flex",alignItems:"center",gap:4}}>
                      <span style={{fontSize:14}}>{sig.emoji}</span>
                      <span style={{fontSize:13,fontWeight:700,color:sig.color,fontFamily:"JetBrains Mono"}}>{sig.label}</span>
                    </div>
                  </div>
                  <div style={{color:"#445",fontSize:11}}>{sel.name} · {sel.sector}</div>
                  <div style={{color:"#2a8",fontSize:9,marginTop:2,fontFamily:"JetBrains Mono"}}>✓ Yahoo Finance · {new Date(cur.fetchedAt).toLocaleTimeString("th-TH",{timeStyle:"short"})}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:24,fontWeight:700,fontFamily:"JetBrains Mono",color:isGold?gc:"#eef",lineHeight:1}}>{fp(cur.currentPrice)}</div>
                  <div style={{fontSize:12,fontWeight:700,marginTop:3,fontFamily:"JetBrains Mono",color:cur.changePct>=0?(isGold?gc:"#00e676"):"#ff4455"}}>
                    {cur.changePct>=0?"▲":"▼"}{Math.abs(cur.changePct).toFixed(2)}% ({cur.change>=0?"+":""}{fp(cur.change)})
                  </div>
                </div>
              </div>
              <div style={{background:isGold?"#100e00":"#0b0f16",border:`1px solid ${isGold?"#3a2800":"#131b24"}`,borderRadius:9,padding:12,marginBottom:12}}>
                <div style={{fontSize:9,color:"#445",fontFamily:"JetBrains Mono",marginBottom:8}}>💰 ราคาสำคัญ (คำนวณจากราคาจริง)</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
                  {[
                    {label:"ราคาปัจจุบัน",val:fp(cur.currentPrice),color:isGold?gc:"#9ab",icon:"📍"},
                    {label:"ควรซื้อที่",val:fp(cur.analysis.buyAt),color:"#00e676",icon:"📗"},
                    {label:"ควรขายที่",val:fp(cur.analysis.sellAt),color:"#ff6b6b",icon:"📕"},
                    {label:"Stop Loss",val:fp(cur.analysis.stopLoss),color:"#ff3355",icon:"🛡️"},
                    {label:"แนวรับ",val:fp(cur.analysis.support),color:"#4ac",icon:"📐"},
                    {label:"แนวต้าน",val:fp(cur.analysis.resistance),color:"#f96",icon:"📐"},
                  ].map(r=>(
                    <div key={r.label} style={{background:"#080c10",borderRadius:6,padding:"8px 10px",border:"1px solid #131b24"}}>
                      <div style={{fontSize:9,color:"#334",marginBottom:2}}>{r.icon} {r.label}</div>
                      <div style={{fontSize:14,fontWeight:700,fontFamily:"JetBrains Mono",color:r.color}}>{r.val}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:8,background:sig.bg,border:`1px solid ${sig.border}`,borderRadius:6,padding:"8px 10px",display:"flex",gap:7,alignItems:"flex-start"}}>
                  <span style={{fontSize:15}}>{sig.emoji}</span>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:sig.color,fontFamily:"JetBrains Mono"}}>ควรทำอย่างไร?</div>
                    <div style={{fontSize:12,color:"#9ab",marginTop:1,lineHeight:1.5}}>{cur.analysis.timing}</div>
                    <div style={{fontSize:10,color:"#556",marginTop:2}}>⏳ ถือถึง: {cur.analysis.holdUntil}</div>
                  </div>
                </div>
              </div>
              <div style={{background:isGold?"#0d0b00":"#0b0f16",border:`1px solid ${isGold?"#2a2000":"#131b24"}`,borderRadius:9,padding:12,marginBottom:12}}>
                <div style={{fontSize:9,color:"#334",fontFamily:"JetBrains Mono",marginBottom:5,display:"flex",justifyContent:"space-between"}}>
                  <span>CHART 30 วัน + พยากรณ์วันนี้</span>
                  <div style={{display:"flex",gap:8,fontSize:8}}><span><span style={{color:isGold?gc:"#00e676"}}>—</span>จริง</span><span><span style={{color:"#a78bfa"}}>--</span>Predict</span></div>
                </div>
                <Chart hist={cur.history} an={cur.analysis} isGold={isGold}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                {cur.analysis.reasons.length>0&&<div style={{background:"#001a0e",border:"1px solid #00e67620",borderRadius:9,padding:9}}><div style={{fontSize:9,color:"#00e676",fontFamily:"JetBrains Mono",marginBottom:4}}>✅ สัญญาณบวก</div>{cur.analysis.reasons.map((r,i)=><div key={i} style={{fontSize:10,color:"#8ab",marginBottom:2,paddingLeft:5,borderLeft:"2px solid #00e67640"}}>{r}</div>)}</div>}
                {cur.analysis.warnings.length>0&&<div style={{background:"#1a0008",border:"1px solid #ff174420",borderRadius:9,padding:9}}><div style={{fontSize:9,color:"#ff6b6b",fontFamily:"JetBrains Mono",marginBottom:4}}>⚠️ สัญญาณลบ</div>{cur.analysis.warnings.map((w,i)=><div key={i} style={{fontSize:10,color:"#a89",marginBottom:2,paddingLeft:5,borderLeft:"2px solid #ff174440"}}>{w}</div>)}</div>}
              </div>
              {sel.type==="gold"?(
                <div style={{background:"linear-gradient(135deg,#181100,#201800)",border:"1px solid #f5c84230",borderRadius:9,padding:12}}>
                  <div style={{fontSize:11,fontWeight:700,color:gc,marginBottom:7}}>🥇 ซื้อทองจริง → Go Now</div>
                  <div style={{display:"flex",gap:7}}>
                    <a href="https://www.gonow.co.th" target="_blank" rel="noopener noreferrer" style={{flex:1,background:"linear-gradient(135deg,#c9a227,#f5c842)",borderRadius:7,padding:"8px 0",color:"#1a1000",fontSize:11,fontWeight:700,textDecoration:"none",textAlign:"center",fontFamily:"JetBrains Mono",display:"block"}}>🥇 Go Now →</a>
                    <a href="https://apps.apple.com/th/app/go-now/id1436296893" target="_blank" rel="noopener noreferrer" style={{flex:1,background:"#0d0c00",border:"1px solid #f5c84230",borderRadius:7,padding:"8px 0",color:gc,fontSize:11,fontWeight:700,textDecoration:"none",textAlign:"center",fontFamily:"JetBrains Mono",display:"block"}}>📱 App →</a>
                  </div>
                </div>
              ):(
                <div style={{background:"#0b0f16",border:"1px solid #131b24",borderRadius:9,padding:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div><div style={{fontSize:11,fontWeight:600,color:"#9ab",marginBottom:1}}>🏦 Bualuang Streaming</div><div style={{fontSize:9,color:"#334"}}>ซื้อ/ขายจริงผ่าน Streaming บัวหลวง</div></div>
                  <a href="https://www.bualuang.co.th/bls" target="_blank" rel="noopener noreferrer" style={{background:"#0e1e30",border:"1px solid #1a3a5c",borderRadius:5,padding:"6px 12px",color:"#4a8abf",fontSize:11,fontWeight:700,textDecoration:"none",fontFamily:"JetBrains Mono"}}>เปิด BLS →</a>
                </div>
              )}
            </div>
          )}
          {!cur&&<div style={{textAlign:"center",padding:"60px 0",color:"#223"}}><div style={{fontSize:28,marginBottom:8}}>📊</div><div>กำลังโหลด...</div></div>}
        </div>
      </div>
    </div>
  );
}
