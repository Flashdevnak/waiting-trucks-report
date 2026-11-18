/* WTR009 original local-only PNO QR/OOXML implementation. No third-party code or network. */
(function (scope) {
'use strict';
const utf8 = s => new TextEncoder().encode(s);
const groups = [null,[[1,26,16]],[[1,44,28]],[[1,70,44]],[[2,50,32]],[[2,67,43]],[[4,43,27]],[[4,49,31]],[[2,60,38],[2,61,39]],[[3,58,36],[2,59,37]],[[4,69,43],[1,70,44]]];
const align = [[],[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
function valid(s) {
 if(typeof s!=='string'||!s.trim()||/[\u0000-\u001f\u007f]/u.test(s))return false;
 for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){if(++i>=s.length||s.charCodeAt(i)<0xdc00||s.charCodeAt(i)>0xdfff)return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}
 return utf8(s).length<=200;
}
const gfExp=new Uint8Array(512),gfLog=new Uint8Array(256);let gx=1;
for(let i=0;i<255;i++){gfExp[i]=gx;gfLog[gx]=i;gx<<=1;if(gx&256)gx^=0x11d;}for(let i=255;i<512;i++)gfExp[i]=gfExp[i-255];
const mul=(a,b)=>a&&b?gfExp[gfLog[a]+gfLog[b]]:0;
function ecc(data,n){let poly=[1];for(let i=0;i<n;i++){let next=Array(poly.length+1).fill(0);for(let j=0;j<poly.length;j++){next[j]^=poly[j];next[j+1]^=mul(poly[j],gfExp[i]);}poly=next;}
 const r=new Uint8Array(n);for(const b of data){const f=b^r[0];r.copyWithin(0,1);r[n-1]=0;for(let j=0;j<n;j++)r[j]^=mul(poly[j+1],f);}return r;}
function penalty(m){const n=m.length;let p=0,dark=0;for(let axis=0;axis<2;axis++)for(let i=0;i<n;i++){let prev=-1,run=0,bits='';for(let j=0;j<n;j++){let v=axis?m[j][i]:m[i][j];bits+=v?'1':'0';if(v===prev)run++;else{if(run>=5)p+=run-2;prev=v;run=1;}}if(run>=5)p+=run-2;for(let j=0;j<=n-11;j++)if(bits.slice(j,j+11)==='00001011101'||bits.slice(j,j+11)==='10111010000')p+=40;}
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){dark+=m[y][x];if(x&&y&&m[y][x]===m[y-1][x]&&m[y][x]===m[y][x-1]&&m[y][x]===m[y-1][x-1])p+=3;}return p+Math.floor(Math.abs(dark*100/(n*n)-50)/5)*10;}
function matrix(payload){if(!valid(payload))throw Error('PNO_QR_CODE_UNAVAILABLE');const data=utf8(payload);let v=1;for(;v<=10;v++){let capacity=groups[v].reduce((s,[c,t,d])=>s+c*d,0)*8;if(12+4+(v<10?8:16)+data.length*8<=capacity)break;}if(v>10)throw Error('PNO_QR_CAPACITY');
 const blocks=[];for(const [c,t,d]of groups[v])for(let i=0;i<c;i++)blocks.push({t,d});const cap=blocks.reduce((s,b)=>s+b.d,0);const bits=[];const put=(n,k)=>{for(let i=k-1;i>=0;i--)bits.push((n>>>i)&1);};put(7,4);put(26,8);put(4,4);put(data.length,v<10?8:16);for(const b of data)put(b,8);put(0,Math.min(4,cap*8-bits.length));while(bits.length%8)bits.push(0);const bytes=[];for(let i=0;i<bits.length;i+=8)bytes.push(bits.slice(i,i+8).reduce((a,b)=>(a<<1)|b,0));for(let i=0;bytes.length<cap;i++)bytes.push(i%2?0x11:0xec);
 let off=0;for(const b of blocks){b.bytes=bytes.slice(off,off+b.d);off+=b.d;b.ecc=ecc(b.bytes,b.t-b.d);}const code=[];for(let i=0;i<Math.max(...blocks.map(b=>b.d));i++)for(const b of blocks)if(i<b.d)code.push(b.bytes[i]);for(let i=0;i<blocks[0].ecc.length;i++)for(const b of blocks)code.push(b.ecc[i]);
 const n=v*4+17,base=Array.from({length:n},()=>Array(n).fill(null));const set=(x,y,b)=>{if(x>=0&&y>=0&&x<n&&y<n)base[y][x]=b?1:0;};
 const finder=(x,y)=>{for(let dy=-1;dy<=7;dy++)for(let dx=-1;dx<=7;dx++)set(x+dx,y+dy,dx>=0&&dx<=6&&dy>=0&&dy<=6&&(dx===0||dx===6||dy===0||dy===6||(dx>=2&&dx<=4&&dy>=2&&dy<=4)));};finder(0,0);finder(n-7,0);finder(0,n-7);
 for(const y of align[v])for(const x of align[v])if(base[y][x]===null)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(x+dx,y+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
 for(let i=8;i<n-8;i++){if(base[6][i]===null)set(i,6,i%2===0);if(base[i][6]===null)set(6,i,i%2===0);}
 const format=(m,mask)=>{let f=mask;for(let i=0;i<10;i++)f=(f<<1)^((f&512)?0x537:0);f=((mask<<10)|f)^0x5412;const bit=i=>(f>>>i)&1;for(let i=0;i<=5;i++)m[i][8]=bit(i);m[7][8]=bit(6);m[8][8]=bit(7);m[8][7]=bit(8);for(let i=9;i<15;i++)m[8][14-i]=bit(i);for(let i=0;i<8;i++)m[8][n-1-i]=bit(i);for(let i=8;i<15;i++)m[n-15+i][8]=bit(i);m[n-8][8]=1;};format(base,0);
 if(v>=7){let b=v;for(let i=0;i<12;i++)b=(b<<1)^((b&0x800)?0x1f25:0);b|=v<<12;for(let i=0;i<18;i++){const a=n-11+i%3,c=Math.floor(i/3);base[c][a]=base[a][c]=(b>>>i)&1;}}
 const masks=[(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,(x,y)=>x%3===0,(x,y)=>(x+y)%3===0,(x,y)=>(Math.floor(y/2)+Math.floor(x/3))%2===0,(x,y)=>(x*y)%2+(x*y)%3===0,(x,y)=>((x*y)%2+(x*y)%3)%2===0,(x,y)=>((x+y)%2+(x*y)%3)%2===0];
 let best,score=Infinity;for(let mask=0;mask<8;mask++){let m=base.map(r=>r.slice()),bi=0,up=true;for(let right=n-1;right>=1;right-=2){if(right===6)right--;for(let vert=0;vert<n;vert++){const y=up?n-1-vert:vert;for(let dx=0;dx<2;dx++){const x=right-dx;if(m[y][x]!==null)continue;let b=bi<code.length*8?(code[bi>>>3]>>>(7-(bi&7)))&1:0;bi++;m[y][x]=b^(masks[mask](x,y)?1:0);}}up=!up;}format(m,mask);const p=penalty(m);if(p<score){score=p;best=m;}}
 return best;
}
const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);return c>>>0;});
const crc=a=>{let c=0xffffffff;for(const b of a)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
function concat(parts){const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
const be=n=>Uint8Array.of(n>>>24,n>>>16,n>>>8,n);
function png(payload){const m=matrix(payload),scale=4,n=(m.length+8)*scale,stride=Math.ceil(n/8),raw=new Uint8Array((stride+1)*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const my=Math.floor(y/scale)-4,mx=Math.floor(x/scale)-4;const white=my<0||mx<0||my>=m.length||mx>=m.length||!m[my][mx];if(white)raw[y*(stride+1)+1+(x>>>3)]|=128>>(x&7);}
 let a=1,b=0;for(const v of raw){a=(a+v)%65521;b=(b+a)%65521;}const z=[Uint8Array.of(0x78,0x01)];for(let i=0;i<raw.length;i+=65535){const block=raw.subarray(i,i+65535),k=block.length;z.push(Uint8Array.of(i+k===raw.length?1:0,k&255,k>>>8,(~k)&255,((~k)>>>8)&255),block);}z.push(be(((b<<16)|a)>>>0));
 const chunk=(name,bytes)=>{let type=utf8(name),body=concat([type,bytes]);return concat([be(bytes.length),body,be(crc(body))]);};return concat([Uint8Array.of(137,80,78,71,13,10,26,10),chunk('IHDR',concat([be(n),be(n),Uint8Array.of(1,0,0,0,0)])),chunk('IDAT',concat(z)),chunk('IEND',new Uint8Array())]);}
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const col=i=>{let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
function zip(entries){let offset=0;const local=[],central=[];const hdr=(len,fn)=>{let b=new Uint8Array(len);fn(new DataView(b.buffer));return b;};for(const [name,value]of entries){let n=utf8(name),v=typeof value==='string'?utf8(value):value,c=crc(v);let h=hdr(30,d=>{d.setUint32(0,0x04034b50,true);d.setUint16(4,20,true);d.setUint16(6,0x800,true);d.setUint32(14,c,true);d.setUint32(18,v.length,true);d.setUint32(22,v.length,true);d.setUint16(26,n.length,true);});local.push(h,n,v);central.push(hdr(46,d=>{d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint32(16,c,true);d.setUint32(20,v.length,true);d.setUint32(24,v.length,true);d.setUint16(28,n.length,true);d.setUint32(42,offset,true);}),n);offset+=h.length+n.length+v.length;}
 const cd=concat(central),end=hdr(22,d=>{d.setUint32(0,0x06054b50,true);d.setUint16(8,entries.length,true);d.setUint16(10,entries.length,true);d.setUint32(12,cd.length,true);d.setUint32(16,offset,true);});return concat([...local,cd,end]);}
const yieldTurn=()=>new Promise(resolve=>{if(typeof MessageChannel==='undefined'){resolve();return;}let c=new MessageChannel();c.port1.onmessage=()=>{c.port1.close();c.port2.close();resolve();};c.port2.postMessage(0);});

// OOXML column widths use the Normal style, independently of visible text.
// Courier New digits are 0.6 em wide: 12.5 pt at 96 DPI yields 10 px.
const excelNormalDigitPixels = 10;
const excelTextDigitPixels = 7;
const excelColumnPadding = 5;
const excelPixelsToPoints = 72 / 96;
const excelLineHeight = 22;
const excelTextPadding = 16;

function excelColumnGeometry(targetPixels) {
 const contentPixels = targetPixels - excelColumnPadding;
 const width = Math.floor((contentPixels + excelColumnPadding) * 256 / excelNormalDigitPixels) / 256;
 const rounding = Math.floor(128 / excelNormalDigitPixels);
 const pixels = Math.floor(((256 * width + rounding) / 256) * excelNormalDigitPixels);
 return {width, pixels};
}

function excelTextLineWidths(value) {
 return String(value ?? '').split(/\r\n|\r|\n/).map(line => {
  let pixels = 0;
  for (const character of line) {
   if (/\p{Mark}/u.test(character)) continue;
   if (character === '\t') pixels += 28;
   else if (character === ' ') pixels += 5;
   else if (/[0-9]/.test(character)) pixels += excelTextDigitPixels;
   else if (/[MW@%&mw]/.test(character)) pixels += 14;
   else if (character.codePointAt(0) > 127) pixels += 16;
   else pixels += 9;
  }
  return pixels;
 });
}

function excelWrappedHeight(value, cellPixels) {
 const usablePixels = cellPixels - excelTextPadding;
 let lines = 0;
 for (const linePixels of excelTextLineWidths(value)) {
  // Reserve slack for native word breaks and font substitution on wrapped lines.
  lines += linePixels <= usablePixels ? 1 : Math.ceil(linePixels / (usablePixels * 0.8));
 }
 return lines * excelLineHeight + excelTextPadding;
}

// Excel Place in Cell: cell.vm -> valueMetadata -> futureMetadata ->
// _localImage rich value -> image relationship -> PNG inside the workbook.
function addExcelLocalImageParts(entries, types, workbookRels, count, namespaces) {
 if (!count) return;
 const {rel, ss, docrel} = namespaces;
 const rich = 'http://schemas.microsoft.com/office/spreadsheetml/2017/richdata';
 const rel2022 = 'http://schemas.microsoft.com/office/2022/10/relationships/';
 const rel2017 = 'http://schemas.microsoft.com/office/2017/06/relationships/';
 const imageRelNs = 'http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel';
 const link = (id, type, target) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
 const part = (id, name, type, contentType, xmlText) => {
  entries.push(['xl/' + name, xmlText]);
  types.push(`<Override PartName="/xl/${name}" ContentType="${contentType}"/>`);
  workbookRels.push(link(id, type, name));
 };

 const future = [], metadata = [], values = [], richRels = [], pngRels = [];
 for (let i = 0; i < count; i++) {
  const imageId = i + 1;
  future.push(`<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="${i}"/></ext></extLst></bk>`);
  metadata.push(`<bk><rc t="1" v="${i}"/></bk>`);
  // CalcOrigin 5 denotes a standalone local image created without a formula.
  values.push(`<rv s="0"><v>${i}</v><v>5</v></rv>`);
  richRels.push(`<rel r:id="rId${imageId}"/>`);
  pngRels.push(link('rId' + imageId, docrel + '/image', `../media/qr${imageId}.png`));
 }

 part('rIdMetadata','metadata.xml',docrel + '/sheetMetadata',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml',
  `<metadata xmlns="${ss}" xmlns:xlrd="${rich}">` +
  '<metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1"/></metadataTypes>' +
  `<futureMetadata name="XLRICHVALUE" count="${count}">${future.join('')}</futureMetadata>` +
  `<valueMetadata count="${count}">${metadata.join('')}</valueMetadata></metadata>`);
 part('rIdRichValueRel','richData/richValueRel.xml',rel2022 + 'richValueRel',
  'application/vnd.ms-excel.richvaluerel+xml',
  `<richValueRels xmlns="${imageRelNs}" xmlns:r="${docrel}">${richRels.join('')}</richValueRels>`);
 part('rIdRichValues','richData/rdrichvalue.xml',rel2017 + 'rdRichValue',
  'application/vnd.ms-excel.rdrichvalue+xml',
  `<rvData xmlns="${rich}" count="${count}">${values.join('')}</rvData>`);
 part('rIdRichStructure','richData/rdrichvaluestructure.xml',rel2017 + 'rdRichValueStructure',
  'application/vnd.ms-excel.rdrichvaluestructure+xml',
  `<rvStructures xmlns="${rich}" count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>`);

 const specialKeys = ['_Self','_DisplayString','_Flags','_Format','_SubLabel','_Attribution','_Icon','_Display','_CanonicalPropertyNames','_ClassificationId'];
 const flags = specialKeys.map(key => `<key name="${key}">` +
  (key === '_Self' ? '<flag name="ExcludeFromFile" value="1"/>' : '') +
  '<flag name="ExcludeFromCalcComparison" value="1"/></key>');
 part('rIdRichTypes','richData/rdRichValueTypes.xml',rel2017 + 'rdRichValueTypes',
  'application/vnd.ms-excel.rdrichvaluetypes+xml',
  `<rvTypesInfo xmlns="${rich}2"><global><keyFlags>${flags.join('')}</keyFlags></global></rvTypesInfo>`);
 entries.push(['xl/richData/_rels/richValueRel.xml.rels',`<Relationships xmlns="${rel}">${pngRels.join('')}</Relationships>`]);
}

async function workbook(sheets,{current=()=>true,yieldFn=yieldTurn}={}){
 const check=()=>{if(!current()){let e=Error('PNO_LOCAL_ASYNC_CANCELLED');e.code='PNO_LOCAL_ASYNC_CANCELLED';throw e;}};check();
 if(!Array.isArray(sheets)||!sheets.length||sheets.length>8||sheets.reduce((s,x)=>s+x.rows.length,0)>10000)throw Error('PNO_EXCEL_LIMIT_10000');
 const ns='http://schemas.openxmlformats.org',rel=ns+'/package/2006/relationships',ss=ns+'/spreadsheetml/2006/main',docrel=ns+'/officeDocument/2006/relationships';
 const qrMinimumCellPixels = 160;
 const qrColumn = excelColumnGeometry(qrMinimumCellPixels);
 const missingQr = 'ไม่มีรหัสสำหรับสร้าง QR';
 // At 96 DPI, 545 pixels are 408.75 pt, within Excel's row-height limit.
 const maxRowPixels = 545;
 const entries=[],media=new Map(),sheetDefs=[],types=[],workRels=[];let processed=0;
 const styles='<styleSheet xmlns="'+ss+'"><fonts count="2"><font><sz val="12.5"/><name val="Courier New"/><family val="3"/></font><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
 types.push('<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>');
 workRels.push('<Relationship Id="rIdStyles" Type="'+docrel+'/styles" Target="styles.xml"/>');
 entries.push(['xl/styles.xml',styles]);
 for(let si=0;si<sheets.length;si++){check();const spec=sheets[si],id=si+1,rows=spec.rows;if(!rows.length)throw Error('PNO_EXCEL_EMPTY_SHEET');let keys=Object.keys(rows[0]),columns=[];
  for(const key of keys){columns.push({key});if((spec.qrKeys||[]).includes(key))columns.push({key,qr:true});}
  if(columns.length>128||rows.some(r=>JSON.stringify(Object.keys(r))!==JSON.stringify(keys)))throw Error('PNO_EXCEL_COLUMNS');
  let rowXml=[];const cell=(value,c,r)=>{const ref=col(c)+r;if(typeof value==='number'&&Number.isFinite(value))return '<c r="'+ref+'" s="0"><v>'+value+'</v></c>';if(typeof value==='boolean')return '<c r="'+ref+'" s="0" t="b"><v>'+(value?1:0)+'</v></c>';return '<c r="'+ref+'" s="0" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';};
  const headers = columns.map(c => c.qr ? 'QR Code (' + c.key + ')' : c.key);
  const geometry = columns.map((column, index) => {
   if (column.qr) return qrColumn;
   const isIdentifier = (spec.qrKeys || []).includes(column.key);
   const minimumPixels = isIdentifier ? 152 : 72;
   const maximumPixels = isIdentifier ? 320 : 288;
   let target = minimumPixels;
   const fit = value => {
    for (const width of excelTextLineWidths(value)) {
     target = Math.min(maximumPixels, Math.max(target, width + excelTextPadding));
    }
   };
   fit(headers[index]);
   for (const row of rows) {
    if (target === maximumPixels) break;
    fit(row[column.key]);
   }
   return excelColumnGeometry(target);
  });
  let headerPixels = 56;
  for (let ci = 0; ci < columns.length; ci++) {
   headerPixels = Math.max(headerPixels, excelWrappedHeight(headers[ci], geometry[ci].pixels));
  }
  headerPixels = Math.min(headerPixels, maxRowPixels);
  rowXml.push('<row r="1" ht="'+(headerPixels*excelPixelsToPoints)+'" customHeight="1">'+headers.map((value,i)=>cell(value,i,1)).join('')+'</row>');
  for(let ri=0;ri<rows.length;ri++){
   check();
   const r=ri+2,row=rows[ri];
   let rowPixels = qrMinimumCellPixels;
   for (let ci = 0; ci < columns.length; ci++) {
    const column = columns[ci];
    const value = row[column.key];
    if (column.qr && valid(value)) continue;
    rowPixels = Math.max(rowPixels, excelWrappedHeight(column.qr ? missingQr : value, geometry[ci].pixels));
   }
   rowPixels = Math.min(rowPixels, maxRowPixels);
   const rowHeight = rowPixels * excelPixelsToPoints;
   const cells=[];
   for (let ci=0; ci<columns.length; ci++) {
    const column=columns[ci], value=row[column.key];
    if (!column.qr) { cells.push(cell(value,ci,r)); continue; }
    if (!valid(value)) { cells.push(cell(missingQr,ci,r)); continue; }
    if(!media.has(value)){const mid=media.size+1;media.set(value,{id:mid,bytes:png(value)});}
    const image=media.get(value);
    // This cached error is for readers without Excel Rich Value support.
    // Supported Excel binds vm to the local image in this very cell.
    cells.push('<c r="'+col(ci)+r+'" s="0" t="e" vm="'+image.id+'"><v>#VALUE!</v></c>');
   }
   rowXml.push('<row r="'+r+'" ht="'+rowHeight+'" customHeight="1">'+cells.join('')+'</row>');if(++processed%32===0){await yieldFn();check();}}
  let sheet='<worksheet xmlns="'+ss+'" xmlns:r="'+docrel+'"><cols>'+geometry.map((column,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+column.width+'" customWidth="1"/>').join('')+'</cols><sheetData>'+rowXml.join('')+'</sheetData>'+'</worksheet>';
  entries.push(['xl/worksheets/sheet'+id+'.xml',sheet]);types.push('<Override PartName="/xl/worksheets/sheet'+id+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
  sheetDefs.push('<sheet name="'+xml(String(spec.name).slice(0,31).replace(/[\\/*?:\[\]]/g,'_'))+'" sheetId="'+id+'" r:id="rId'+id+'"/>');workRels.push('<Relationship Id="rId'+id+'" Type="'+docrel+'/worksheet" Target="worksheets/sheet'+id+'.xml"/>');}
 check();
 addExcelLocalImageParts(entries,types,workRels,media.size,{rel,ss,docrel});
 for(const m of media.values())entries.push(['xl/media/qr'+m.id+'.png',m.bytes]);
 entries.push(['[Content_Types].xml','<Types xmlns="'+ns+'/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+types.join('')+'</Types>'],['_rels/.rels','<Relationships xmlns="'+rel+'"><Relationship Id="rId1" Type="'+docrel+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'],['xl/workbook.xml','<workbook xmlns="'+ss+'" xmlns:r="'+docrel+'"><sheets>'+sheetDefs.join('')+'</sheets></workbook>'],['xl/_rels/workbook.xml.rels','<Relationships xmlns="'+rel+'">'+workRels.join('')+'</Relationships>']);
 const bytes=zip(entries);check();return bytes;
}
scope.PnoQr009=Object.freeze({valid,matrix,png,workbook});
})(globalThis);
