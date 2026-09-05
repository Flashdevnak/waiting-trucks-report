const STATE_LABELS={1:'รอเปิดบาร์โค้ด',2:'เปิดบาร์โค้ดแล้ว',7:'ถึงสาขาต้นทางแล้ว',3:'รถออกจากต้นทางแล้ว',4:'จบเที่ยวแล้ว',6:'รอยกเลิก',5:'ยกเลิกแล้ว'};
const PRINTABLE_STATES=new Set([1,2,7]);

export async function maybeHandleProofEditor(request,env,ctx,baseWorker){
  const url=new URL(request.url);
  const path=url.pathname;
  const handled=new Set(['/api/proof/editor','/api/proof/driver-options','/api/proof/plate-options','/api/proof/print-edit']);
  if(!handled.has(path))return null;
  if(request.method==='OPTIONS')return new Response(null,{headers:cors()});
  try{
    if(request.method==='GET'&&path==='/api/proof/editor'){
      const token=url.searchParams.get('token')||'';
      const branch=cleanHub(url.searchParams.get('branch')||'NE1');
      const lineId=text(url.searchParams.get('lineId'),100);
      const departureDate=cleanDay(url.searchParams.get('departureDate'));
      if(!lineId||!departureDate)fail('ข้อมูลเที่ยวรถไม่ครบ','INVALID_EDITOR_REQUEST');
      await authorize(token,branch,env,baseWorker);
      const credentials=await requiredCredentials(env,branch);
      const detail=await readProofPopup(credentials,lineId,departureDate);
      return json({ok:true,data:publicEditor(detail,departureDate)});
    }

    if(request.method==='GET'&&path==='/api/proof/driver-options'){
      const token=url.searchParams.get('token')||'';
      const branch=cleanHub(url.searchParams.get('branch')||'NE1');
      const lineId=text(url.searchParams.get('lineId'),100);
      const departureDate=cleanDay(url.searchParams.get('departureDate'));
      const q=text(url.searchParams.get('q'),80);
      if(!lineId||!departureDate)fail('ข้อมูลเที่ยวรถไม่ครบ','INVALID_DRIVER_SEARCH');
      await authorize(token,branch,env,baseWorker);
      const credentials=await requiredCredentials(env,branch);
      const detail=await readProofPopup(credentials,lineId,departureDate);
      const policy=editPolicy(detail);
      if(!policy.driverEditable)return json({ok:true,data:{items:[],locked:true,reason:policy.driverReason}});
      const items=await readDriverOptions(credentials,detail,q);
      return json({ok:true,data:{items:items.map(publicDriver),locked:false}});
    }

    if(request.method==='GET'&&path==='/api/proof/plate-options'){
      const token=url.searchParams.get('token')||'';
      const branch=cleanHub(url.searchParams.get('branch')||'NE1');
      const lineId=text(url.searchParams.get('lineId'),100);
      const departureDate=cleanDay(url.searchParams.get('departureDate'));
      const q=text(url.searchParams.get('q'),80);
      if(!lineId||!departureDate)fail('ข้อมูลเที่ยวรถไม่ครบ','INVALID_PLATE_SEARCH');
      await authorize(token,branch,env,baseWorker);
      const credentials=await requiredCredentials(env,branch);
      const detail=await readProofPopup(credentials,lineId,departureDate);
      const policy=editPolicy(detail);
      if(!policy.plateEditable)return json({ok:true,data:{items:[],locked:true,reason:policy.plateReason}});
      const items=await readPlateOptions(credentials,detail,q,'');
      return json({ok:true,data:{items:items.map(publicPlate),locked:false}});
    }

    if(request.method==='POST'&&path==='/api/proof/print-edit'){
      const body=await request.json();
      const branch=cleanHub(body.branch||'NE1');
      const actor=await authorize(body.token||'',branch,env,baseWorker);
      const lineId=text(body.lineId,100);
      const departureDate=cleanDay(body.departureDate);
      const selection=body.selection&&typeof body.selection==='object'?body.selection:{};
      return await printEdited({env,ctx,branch,actor,lineId,departureDate,selection});
    }

    return json({ok:false,code:'METHOD_NOT_ALLOWED',message:'Method not allowed'},405);
  }catch(error){
    console.error(JSON.stringify({event:'proof_editor_error',path,code:error.code||'PROOF_EDITOR_ERROR',message:error.message||String(error)}));
    return json({ok:false,code:error.code||'PROOF_EDITOR_ERROR',message:error.message||'จัดการข้อมูลก่อนปริ้นไม่สำเร็จ'},error.status||400);
  }
}

async function printEdited({env,ctx,branch,actor,lineId,departureDate,selection}){
  if(!lineId||!departureDate)fail('ข้อมูลเที่ยวรถไม่ครบ','INVALID_PRINT_REQUEST');
  const credentials=await requiredCredentials(env,branch);
  const profile=await readMsProfile(credentials);
  const permissions=new Set(Array.isArray(profile.permissions)?profile.permissions:[]);
  if(!permissions.has('action.store.proof_printing'))fail('บัญชี MS นี้ไม่มีสิทธิ์ปริ้นบาร์โค้ดประจำรถ','MS_PRINT_PERMISSION_DENIED',403);

  // Read again immediately before any write. This is the authoritative lock/state check.
  const detail=await readProofPopup(credentials,lineId,departureDate);
  const state=Number(detail.proof_state);
  if(!PRINTABLE_STATES.has(state))fail(state===6?'รถรายการนี้อยู่ระหว่างรอยกเลิก จึงไม่สามารถปริ้นได้':'สถานะล่าสุดใน MS ไม่รองรับการปริ้น กรุณารีเฟรชข้อมูล','MS_PRINT_STATE_NOT_ALLOWED',409);
  if(state===1&&!text(detail.proof_id,100)&&releasePassed(detail.expect_start_time,departureDate))fail('เลยเวลาปล่อยแล้ว ระบบจัดเป็นรถไม่เข้าและจะไม่เปิดบาร์โค้ดใหม่','MS_PROOF_RELEASE_PASSED',409);
  if(state===1&&!permissions.has('action.store.proof_create'))fail('บัญชี MS นี้ไม่มีสิทธิ์เปิดใช้งานบาร์โค้ดรถ','MS_CREATE_PERMISSION_DENIED',403);

  const policy=editPolicy(detail);
  const chosen={
    plateId:detail.plate_id==null?'':String(detail.plate_id),
    plateNumber:text(detail.plate_number,120),
    plateType:detail.plate_type??'',
    plateTypeText:text(detail.plate_type_text,80),
    fmsDriverId:detail.fms_driver_id??'',
    driver:text(detail.driver,180),
    driverPhone:text(detail.driver_phone,40),
  };

  const requestedPlateId=text(selection.plateId,100);
  if(requestedPlateId&&requestedPlateId!==chosen.plateId){
    if(!policy.plateEditable)fail(policy.plateReason||'MS ล็อกทะเบียนรถเที่ยวนี้','MS_PLATE_LOCKED',409);
    const plate=await verifyPlate(credentials,detail,requestedPlateId);
    chosen.plateId=String(plate.id||'');
    chosen.plateNumber=plateDisplay(plate);
    const vo=plate.fleet_company_car_type_vo||{};
    chosen.plateType=vo.car_type??plate.type??detail.plate_type??'';
    chosen.plateTypeText=text(vo.car_type_text||plate.type_text||detail.plate_type_text,80);
  }

  const requestedDriverId=text(selection.fmsDriverId,100);
  if(requestedDriverId&&requestedDriverId!==String(chosen.fmsDriverId??'')){
    if(!policy.driverEditable)fail(policy.driverReason||'MS ล็อกข้อมูลคนขับเที่ยวนี้','MS_DRIVER_LOCKED',409);
    const driver=await verifyDriver(credentials,detail,requestedDriverId);
    chosen.fmsDriverId=driver.driver_id??'';
    chosen.driver=text(driver.driver_name,180);
    chosen.driverPhone=text(driver.mobile,40);
  }

  const payload={
    departure_time:detail.expect_start_time||`${departureDate} 00:00`,
    line_id:detail.line_id||lineId,
    driver:chosen.driver,
    driver_phone:chosen.driverPhone,
    plate_id:chosen.plateId,
    plate_number:chosen.plateNumber,
    plate_type:chosen.plateType,
    driver_id:detail.driver_id==null?'':String(detail.driver_id),
    fleet_id:detail.fleet_id==null?'':String(detail.fleet_id),
    fms_driver_id:chosen.fmsDriverId,
    fms_co_driver_id:detail.fms_co_driver_id??'',
    fms_co_driver:detail.fms_co_driver||'',
    fms_co_driver_phone:detail.fms_co_driver_phone||'',
  };

  // Match the MS page: first POST; only POST again with id when MS says the proof already exists.
  const first=await postProof(credentials,payload);
  const firstData=first?.data;
  let proofId='';
  if(firstData&&typeof firstData==='object'){
    proofId=text(firstData.id,100);
    if(firstData.existed===true){
      if(!proofId)fail('MS ไม่คืนเลขบาร์โค้ดรถ','MS_PROOF_ID_MISSING',502);
      const second=await postProof(credentials,{...payload,id:proofId});
      proofId=text(second?.data?.id||second?.data||proofId,100);
    }
  }else{
    proofId=text(firstData||detail.proof_id,100);
  }
  if(!proofId)proofId=text(detail.proof_id,100);
  if(!proofId)fail('MS ไม่คืนเลขบาร์โค้ดรถ','MS_PROOF_ID_MISSING',502);

  const printUrl=`https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/van/proof/${encodeURIComponent(proofId)}/print`;
  const response=await fetch(printUrl,{headers:msHeaders(credentials)});
  if(!response.ok)fail(`MS สร้าง PDF ไม่สำเร็จ (${response.status})`,'MS_PRINT_HTTP_ERROR',502);
  const contentType=response.headers.get('content-type')||'';
  if(!contentType.toLowerCase().includes('pdf'))fail('MS ไม่ได้ส่งไฟล์ PDF กลับมา','MS_PRINT_INVALID_RESPONSE',502);
  const pdf=await response.arrayBuffer();

  try{
    await env.DB.prepare(`INSERT INTO ms_proof_print_log(id,hub,business_day,line_id,proof_id,route_name,printed_at,ms_operator_name,ms_operator_id,web_operator) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(
      crypto.randomUUID(),branch,departureDate,lineId,proofId,text(detail.line_name,300),new Date().toISOString(),text(profile.name,160),String(profile.id||''),text(actor.username,60),
    ).run();
  }catch(error){console.error(JSON.stringify({event:'proof_editor_print_log_error',branch,proofId,message:error.message||String(error)}));}

  return new Response(pdf,{status:200,headers:{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${proofId}.pdf"`,'Cache-Control':'no-store','X-MS-Proof-Id':proofId,'X-MS-Operator-Name':encodeURIComponent(text(profile.name,160)),...cors()}});
}

function editPolicy(detail){
  const lineMode=Number(detail.line_mode);
  const lineType=Number(detail.line_type);
  const auditType=detail.audit_type==null?null:Number(detail.audit_type);
  const fleetLocked=detail.fleet_app_sign_flag===true;
  const special=lineMode===4||lineType===4||auditType===2;
  const plateEditable=Boolean(detail.fleet_id)&&(auditType===1||(lineMode===1&&lineType!==4))&&lineMode!==4&&auditType!==2;
  let plateReason='';
  if(!plateEditable){
    if(lineMode===4||auditType===2)plateReason='MS ล็อกทะเบียนตามประเภทเที่ยว/การตรวจสอบของเที่ยวนี้';
    else if(!detail.fleet_id)plateReason='MS ไม่ได้ผูกบริษัทซัพสำหรับเลือกทะเบียน';
    else plateReason='MS ไม่เปิดช่องเลือกทะเบียนสำหรับเที่ยวนี้';
  }
  const driverEditable=!special&&Boolean(detail.fleet_id)&&!fleetLocked;
  let driverReason='';
  if(!driverEditable){
    if(fleetLocked)driverReason='ข้อมูลคนขับถูกล็อกจากระบบ Fleet/App ของ MS';
    else if(special)driverReason='MS ใช้กติกาคนขับแบบพิเศษสำหรับเที่ยวนี้';
    else if(!detail.fleet_id)driverReason='MS ไม่ได้ผูกบริษัทซัพสำหรับเลือกคนขับ';
    else driverReason='MS ล็อกข้อมูลคนขับเที่ยวนี้';
  }
  return {plateEditable,driverEditable,phoneEditable:driverEditable,phoneLinkedToDriver:true,plateReason,driverReason,specialMode:special};
}

function publicEditor(detail,departureDate){
  const policy=editPolicy(detail);
  const code=detail.proof_state==null?null:Number(detail.proof_state);
  return {
    lineId:text(detail.line_id,100),departureDate,lineName:text(detail.line_name,320),originName:text(detail.origin_name,200),track:text(detail.track,120),plannedDepartureText:text(detail.expect_start_time,80),
    lineMode:detail.line_mode==null?null:Number(detail.line_mode),lineType:detail.line_type==null?null:Number(detail.line_type),auditType:detail.audit_type==null?null:Number(detail.audit_type),
    fleetId:text(detail.fleet_id,100),fleetName:text(detail.fleet_name,200),plateId:text(detail.plate_id,100),plateNumber:text(detail.plate_number,120),plateType:detail.plate_type??null,plateTypeText:text(detail.plate_type_text,80),
    fmsDriverId:detail.fms_driver_id==null?'':String(detail.fms_driver_id),driverId:text(detail.driver_id,100),driver:text(detail.driver,180),driverPhone:text(detail.driver_phone,40),
    proofId:text(detail.proof_id,100),proofState:code,proofStateText:STATE_LABELS[code]||text(detail.proof_state_text,120)||'ไม่ทราบสถานะ',fleetAppSignFlag:detail.fleet_app_sign_flag===true,editDriverIdEnabled:detail.edit_driver_id_enabled===true,
    policy,checkedAt:new Date().toISOString(),source:'MS_PROOF_POPUP_EDITOR',
  };
}

async function readDriverOptions(credentials,detail,q){
  const url=new URL('https://ms-api.flashexpress.com/gw/fms/ms/driver/list');
  url.searchParams.set('fleetId',String(detail.fleet_id||''));
  url.searchParams.set('carType','');
  const raw=text(q,80),digits=raw.replace(/\D/g,''),compact=raw.replace(/\s/g,''),query=(digits.length>=4&&digits.length>=compact.length-2)?digits:raw;
  if(query)url.searchParams.set('nameOrMobile',query); else if(detail.fms_driver_id!=null)url.searchParams.set('driverId',String(detail.fms_driver_id));
  const payload=await readMsJson(await fetch(url,{headers:msHeaders(credentials)}),'MS_DRIVER_LIST_ERROR');
  const items=Array.isArray(payload.data)?payload.data:Array.isArray(payload.data?.items)?payload.data.items:[],seen=new Set(),out=[];
  for(const item of items){const key=String(item?.driver_id??'')||`${text(item?.driver_name,180)}|${text(item?.mobile,40)}`;if(!key||seen.has(key))continue;seen.add(key);out.push(item);}
  return out; // PROOF_DRIVER_SEARCH_V8: one request only when user explicitly searches.
}

async function readPlateOptions(credentials,detail,q,id){
  const params={fleetId:String(detail.fleet_id||''),id:id||'',plateNumber:q||'',pageSize:'20',pageNum:'1',plateType:''};
  const urls=[new URL('https://ms-api.flashexpress.com/gw/fms/ms/car/car/info'),new URL(`https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/van/${encodeURIComponent(String(detail.fleet_id||''))}`)];
  let lastError=null;
  for(const url of urls){
    for(const[k,v]of Object.entries(params))url.searchParams.set(k,v);
    try{
      const payload=await readMsJson(await fetch(url,{headers:msHeaders(credentials)}),'MS_PLATE_LIST_ERROR');
      const data=payload.data;
      const items=plateItems(data);
      if(items.length||url.pathname.includes('/car/info'))return items;
    }catch(error){lastError=error;}
  }
  if(lastError)throw lastError;
  return [];
}

function plateItems(data){if(Array.isArray(data))return data;if(!data||typeof data!=='object')return [];for(const key of ['items','list','records','rows','content','data']){if(Array.isArray(data[key]))return data[key];if(data[key]&&typeof data[key]==='object'){const nested=plateItems(data[key]);if(nested.length)return nested;}}return [];}
function releasePassed(value,day){const n=Number(value);if(Number.isFinite(n)&&String(value).trim()!==''&&n>=0&&n<3000){const base=Date.parse(`${day}T00:00:00+07:00`);return Number.isFinite(base)&&Date.now()>=base+n*60_000;}const raw=String(value||'').trim();let m=raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);if(m){const at=Date.parse(`${m[1]}T${String(m[2]).padStart(2,'0')}:${m[3]}:${m[4]||'00'}+07:00`);return Number.isFinite(at)&&Date.now()>=at;}m=raw.match(/(\d{1,2}):(\d{2})/);if(m){const at=Date.parse(`${day}T${String(m[1]).padStart(2,'0')}:${m[2]}:00+07:00`);return Number.isFinite(at)&&Date.now()>=at;}return false;} // PROOF_RELEASE_GUARD_V10
async function verifyDriver(credentials,detail,id){
  const url=new URL('https://ms-api.flashexpress.com/gw/fms/ms/driver/list');
  url.searchParams.set('fleetId',String(detail.fleet_id||''));url.searchParams.set('carType','');url.searchParams.set('driverId',id);
  const payload=await readMsJson(await fetch(url,{headers:msHeaders(credentials)}),'MS_DRIVER_VERIFY_ERROR');
  const items=Array.isArray(payload.data)?payload.data:Array.isArray(payload.data?.items)?payload.data.items:[];
  const hit=items.find(x=>String(x.driver_id)===String(id));
  if(!hit)fail('ไม่พบคนขับที่เลือกใน MS กรุณาค้นหาใหม่','MS_DRIVER_NOT_FOUND',409);
  return hit;
}

async function verifyPlate(credentials,detail,id){
  const items=await readPlateOptions(credentials,detail,'',id);
  const hit=items.find(x=>String(x.id)===String(id));
  if(!hit)fail('ไม่พบทะเบียนที่เลือกใน MS กรุณาค้นหาใหม่','MS_PLATE_NOT_FOUND',409);
  return hit;
}

function publicDriver(x){return {id:String(x.driver_id??''),name:text(x.driver_name,180),phone:text(x.mobile,40),auditState:x.driver_card_audit_state??null,auditStateText:text(x.driver_card_audit_state_text,100),label:`${text(x.driver_name,180)}${x.mobile?` • ${text(x.mobile,40)}`:''}`};}
function plateDisplay(x){const base=text(x.plate_number||x.label,120);if(/\(.+\)$/.test(base))return base;const province=text(x.fleet_company_car_type_vo?.province_name||x.province_name,80);return province?`${base}(${province})`:base;}
function publicPlate(x){const vo=x.fleet_company_car_type_vo||{};return {id:String(x.id??''),plateNumber:plateDisplay(x),plateType:vo.car_type??x.type??null,plateTypeText:text(vo.car_type_text||x.type_text,80),provinceName:text(vo.province_name||x.province_name,80),label:[plateDisplay(x),text(vo.car_type_text||x.type_text,80)].filter(Boolean).join(' • ')};}

async function readProofPopup(credentials,lineId,departureDate){const url=new URL('https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/van/proof/popup');url.searchParams.set('lineId',lineId);url.searchParams.set('departureDate',departureDate);const payload=await readMsJson(await fetch(url,{headers:msHeaders(credentials)}),'MS_PROOF_POPUP_ERROR');return payload.data||{};}
async function readMsProfile(credentials){const payload=await readMsJson(await fetch('https://ms-api.flashexpress.com/gw/nws/staff/ms/setting/login/profile',{headers:msHeaders(credentials)}),'MS_PROFILE_ERROR');return payload.data||{};}
async function postProof(credentials,body){return readMsJson(await fetch('https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/van/proof',{method:'POST',headers:{...msHeaders(credentials),'Content-Type':'application/json;charset=UTF-8'},body:JSON.stringify(body)}),'MS_PROOF_POST_ERROR');}
async function readMsJson(response,code){let payload=null;try{payload=await response.json();}catch{fail(`MS ตอบกลับข้อมูลที่อ่านไม่ได้ (${response.status})`,code,502);}if(!response.ok||Number(payload?.code)!==1)fail(payload?.message||`MS ตอบกลับ ${response.status}`,code,response.status===401?401:502);return payload;}

async function authorize(token,branch,env,baseWorker){if(!token)fail('กรุณาเข้าสู่ระบบ','INVALID_SESSION',401);const internal=new URL('https://worker.internal/api');internal.searchParams.set('action','settings');internal.searchParams.set('token',token);internal.searchParams.set('branch',branch);const response=await baseWorker.fetch(new Request(internal,{method:'GET'}),env);let payload=null;try{payload=await response.json();}catch{}if(!response.ok||!payload?.ok)fail(payload?.message||'สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',payload?.code||'INVALID_SESSION',response.status||401);return decodeActor(token);}
function decodeActor(token){try{const raw=String(token).split('.')[0].replace(/-/g,'+').replace(/_/g,'/');const decoded=atob(raw.padEnd(Math.ceil(raw.length/4)*4,'='));return JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded,c=>c.charCodeAt(0))));}catch{return {username:''};}}
async function requiredCredentials(env,hub){const c=await msCredentials(env,hub);if(!c)fail(`HUB ${hub} ยังไม่ได้เชื่อมต่อ MS`,'MS_NOT_CONFIGURED',409);return c;}
async function msCredentials(env,hub){const row=await env.DB.prepare('SELECT session_cipher,device_cipher FROM ms_connections WHERE hub=?').bind(hub).first();if(row)return {sessionId:await decryptMs(row.session_cipher,env),deviceId:await decryptMs(row.device_cipher,env)};if(hub===cleanHub(env.MS_BRANCH||'NE1')&&env.MS_SESSION_ID&&env.MS_DEVICE_ID)return {sessionId:env.MS_SESSION_ID,deviceId:env.MS_DEVICE_ID};return null;}
async function decryptMs(value,env){const[iv,cipher]=String(value||'').split('.');if(!iv||!cipher)fail('ข้อมูลเชื่อมต่อ MS เสียหาย','MS_CREDENTIAL_ERROR',500);const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${env.AUTH_SECRET}|ms-credentials`));const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},key,unb64(cipher));return new TextDecoder().decode(data);}
function msHeaders(c){return {Accept:'application/json, text/plain, */*','Accept-Language':'th','Cache-Control':'no-cache',Origin:'https://ms.flashexpress.com',Referer:'https://ms.flashexpress.com/','User-Agent':'Mozilla/5.0','X-DEVICE-ID':c.deviceId,'X-FH-MS-EQUIPMENT-TYPE':'5','X-FLE-SESSION-ID':c.sessionId};}
function cleanHub(v){return text(v,80).toUpperCase();}function cleanDay(v){const s=text(v,20);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';}function text(v,n=500){return String(v??'').trim().slice(0,n);}function unb64(v){const s=String(v||'').replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(s.padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));}function fail(message,code='PROOF_EDITOR_ERROR',status=400){const e=new Error(message);e.code=code;e.status=status;throw e;}function cors(){return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};}function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}});}
