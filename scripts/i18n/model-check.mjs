import fs from 'node:fs/promises'
import dotenv from 'dotenv'
dotenv.config({path:'.env.local',quiet:true})
const key=process.env.GEMINI_API_KEY
const headers={'x-goog-api-key':key,'Content-Type':'application/json'}
const list=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',{headers})
const data=await list.json()
console.log(JSON.stringify({listStatus:list.status,models:data.models?.filter(x=>/gemini-(2.5-pro|3.[158]-)/.test(x.name)).map(x=>x.name)}))
const source=['カラーコレクションは、撮影で生じた差を整える工程です。カラーグレーディングでは、その上で作品のルックを作ります。','私は、⟦0⟧DaVinci Resolve 認定トレーナー⟦/0⟧として講義もしています。','則兼 智志 | カラリスト','映像の色で物語を翻訳する。','ゲイン（乗算）','ガンマ（べき乗）']
const results=[]
for(const model of ['gemini-3.8-flash','gemini-3.5-flash','gemini-2.5-pro']) {
 const started=Date.now()
 try {
 const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers,signal:AbortSignal.timeout(150000),body:JSON.stringify({contents:[{parts:[{text:'Translate this Japanese document to English. Plain direct first person, correct professional film terms, distinguish color correction and color grading. Person is Satoshi Norikane. Preserve marker pairs on their translated phrase. Return only a JSON array of translated strings.\n'+JSON.stringify(source)}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:8192,...(model.includes('2.5')?{}:{thinkingConfig:{thinkingLevel:'high'}})}})})
 const body=await response.json(); const result={model,status:response.status,seconds:(Date.now()-started)/1000,finishReason:body.candidates?.[0]?.finishReason,text:body.candidates?.[0]?.content?.parts?.filter(x=>!x.thought).map(x=>x.text||'').join(''),usage:body.usageMetadata,error:body.error?.status};results.push(result);console.log(JSON.stringify(result))
 }catch(e){results.push({model,error:e.name});console.log(JSON.stringify({model,error:e.name}))}
}
if (process.argv[2]) await fs.writeFile(process.argv[2], JSON.stringify(results, null, 2))
