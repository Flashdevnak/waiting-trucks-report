const WORKER_MARKER = "PNO_ROUND2_BARCODE_BACKING_V1";
const FRONTEND_MARKER = "PNO_ROUND2_UI_V1";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`${label}: anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchPnoRound2Worker(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;
  if (!output.includes("PNO_ULTRA_LOW_QUOTA_V1")) return output;

  output = replaceOnce(
    output,
    '  if (mapped.attendanceType === "à¸›à¸¥à¸²à¸¢à¸—à¸²à¸‡") {',
    '  // PNO_ROUND2_BARCODE_BACKING_V1: destination and drop-point are inbound PNO truth; origin remains excluded.\n' +
      '  if (mapped.attendanceType === "à¸›à¸¥à¸²à¸¢à¸—à¸²à¸‡" || mapped.attendanceType === "à¸ˆà¸¸à¸”à¸”à¸£à¸­à¸›") {',
    "round2 attendance eligibility",
  );

  output = replaceOnce(
    output,
    'function pnoViewKey(row) {\n  return `${normalizeProofId(row?.proofId)}|${normalizeMsAttendance(row?.attendanceType)}`;\n}',
    'function pnoViewKey(row) {\n  // Barcode/proofId is the one-truck primary key.\n  return normalizeProofId(row?.proofId);\n}',
    "round2 proof-only metadata key",
  );

  output = replaceOnce(
    output,
    '    if (normalizeMsAttendance(row?.attendanceType) !== "à¸›à¸¥à¸²à¸¢à¸—à¸²à¸‡") continue;',
    '    if (!["à¸›à¸¥à¸²à¸¢à¸—à¸²à¸‡", "à¸ˆà¸¸à¸”à¸”à¸£à¸­à¸›"].includes(normalizeMsAttendance(row?.attendanceType))) continue;',
    "round2 drop metadata eligibility",
  );

  output = replaceOnce(
    output,
    'function preEntrySemanticKey(value) {\n  // Duplicate conflict is about trip identity/source truth, not a normal count\n  // progression between yesterday/today snapshots of the same trip.\n  return JSON.stringify({\n    lineId: value.pnoLineId || "",\n    vanLineId: value.pnoVanLineId || "",\n    storeId: value.pnoStoreId || "",\n    nextStoreId: value.pnoNextStoreId || "",\n    expected: value.expectedParcels,\n  });\n}',
    'function preEntrySemanticKey(value) {\n  // Business truth: one truck has one Barcode. Exact proofId is the primary key;\n  // overlapping source-day snapshots are revisions of the same trip, not duplicates.\n  return normalizeProofId(value?.proofId);\n}',
    "round2 barcode-primary collapse",
  );

  const oldBacking = '      backingNo: text(row.bag_no || row.bagging_no || row.backing_no || row.pack_no || row.bag_code || row.package_no || row.backingNo, 120),';
  const newBacking = '      // HAR truth: FBI route_followstart_list exposes Backing/Bagging in pack_no.\n' +
    '      backingNo: text(row.pack_no || row.backingNo || row.backing_no || row.bagging_no || row.bag_no || row.bag_code || row.package_no, 120),';
  output = replaceOnce(output, oldBacking, newBacking, "round2 pack_no primary mapping");

  output = replaceOnce(
    output,
    '    })).filter((row) => row.pno);',
    '    })).filter((row) => row.pno || row.backingNo);',
    "round2 retain backing rows",
  );

  return output;
}

export function patchPnoRound2Frontend(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;
  if (!output.includes("PNO_BROWSER_CACHE_V1")) return output;

  output = replaceOnce(
    output,
    'function pnoProgressClass(percent) {\n  if (percent >= 100) return "is-complete";\n  if (percent >= 90) return "is-green";\n  if (percent >= 60) return "is-amber";\n  return "is-red";\n}',
    'function pnoProgressClass(percent) {\n  if (percent >= 100) return "is-complete";\n  if (percent >= 90) return "is-green";\n  if (percent >= 60) return "is-amber";\n  return "is-red";\n}\n\n' +
    'function pnoProgressStatus(percent) {\n  if (percent >= 100) return "à¹€à¸‚à¹‰à¸²à¸„à¸¥à¸±à¸‡à¸„à¸£à¸š";\n  if (percent >= 90) return "à¸œà¹ˆà¸²à¸™à¹€à¸›à¹‰à¸²";\n  if (percent >= 60) return "à¸à¸³à¸¥à¸±à¸‡à¹€à¸‚à¹‰à¸²à¸„à¸¥à¸±à¸‡";\n  return "à¸•à¹ˆà¸³à¸à¸§à¹ˆà¸²à¹€à¸›à¹‰à¸²";\n}',
    "round2 progress status",
  );

  const duplicateBadge = '  if (row.pnoState === "AMBIGUOUS")\n    return \'<div class="expected-parcels-badge pno-summary pno-warning"><strong>à¸‚à¹‰à¸­à¸¡à¸¹à¸¥ Barcode à¸‹à¹‰à¸³ â€” à¸•à¹‰à¸­à¸‡à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸š</strong><span>à¹„à¸¡à¹ˆà¹à¸ªà¸”à¸‡à¹€à¸›à¸­à¸£à¹Œà¹€à¸‹à¹‡à¸™à¸•à¹Œà¹à¸¥à¸°à¸›à¸´à¸” PNO à¹€à¸žà¸·à¹ˆà¸­à¹„à¸¡à¹ˆà¹ƒà¸«à¹‰à¹€à¸”à¸²à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸œà¸´à¸”à¹€à¸—à¸µà¹ˆà¸¢à¸§</span></div>\';\n';
  if (output.includes(duplicateBadge)) output = output.replace(duplicateBadge, "");

  output = replaceOnce(
    output,
    '<div class="pno-progress-head"><strong>${pnoDisplayPercent(percent)}</strong><span>à¹€à¸‚à¹‰à¸²à¸„à¸¥à¸±à¸‡à¹à¸¥à¹‰à¸§</span></div>',
    '<div class="pno-progress-head"><strong>${pnoDisplayPercent(percent)}</strong><span>${pnoProgressStatus(percent)} Â· à¹€à¸›à¹‰à¸² 90%</span></div>',
    "round2 v8 status label",
   );

  const oldMessage = '    const message = row?.pnoState === "AMBIGUOUS"\n      ? "à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸‹à¹‰à¸³ â€” à¸•à¹‰à¸­à¸‡à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¸à¹ˆà¸­à¸™à¹€à¸›à¸´à¸” PNO"\n      : row?.pnoState === "COUNT_MISMATCH"\n        ? "à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ˆà¸³à¸™à¸§à¸™à¹„à¸¡à¹ˆà¸ªà¸¡à¸šà¸¹à¸£à¸“à¹Œ à¸ˆà¸¶à¸‡à¸¢à¸±à¸‡à¹€à¸›à¸´à¸” PNO à¹„à¸¡à¹ˆà¹„à¸”à¹‰"\n        : "à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¸¡à¸µà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸‚à¹‰à¸²à¸„à¸¥à¸±à¸‡à¸ªà¸³à¸«à¸£à¸±à¸šà¹€à¸›à¸´à¸” PNO";';
  const newMessage = '    const message = row?.pnoState === "COUNT_MISMATCH"\n      ? "à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ˆà¸³à¸™à¸§à¸™à¹„à¸¡à¹ˆà¸ªà¸¡à¸šà¸¹à¸£à¸“à¹Œ à¸ˆà¸¶à¸‡à¸¢à¸±à¸‡à¹€à¸›à¸´à¸” PNO à¹„à¸¡à¹ˆà¹„à¸”à¹‰"\n      : "à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¸¡à¸µà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸‚à¹‰à¸²à¸„à¸¥à¸±à¸‡à¸ªà¸³à¸«à¸£à¸±à¸šà¹€à¸›à¸´à¸” PNO";';
  if (output.includes(oldMessage)) output = output.replace(oldMessage, newMessage);

  output = replaceOnce(
    output,
    '<table><thead><tr><th>à¸¥à¸°à¸”à¸±àºhð½Ñ øñÑ ùA9<€¼ƒ‚æ‚âk‚æ‚â‚â‚âÓ‚æ'‚âð½Ñ øñÑ û‚â«‚â[‚âË‚âg‚âÀA9<ð½Ñ øñÑ û‚â‚âË‚â‚âS‚âÏ‚æ‚âg‚âÓ‚âg‚â‚âË‚â‚â—‚æ#‚âË‚â«‚âã‚âP€¼ƒ‚æ‚âŸ‚â—‚âÈð½Ñ øñÑ ù!U€¼ƒ‚â«‚âË‚â‚âÈð½Ñ øð½ÑÈøð½Ñ¡•…øñÑ‰½‘äø‘íÁ•¹‘¥¹A…É•±I½ÝÌ¹µ…À ¡¥Ñ•´°¥¹‘•à¤€ôø€ñÑÈøñÑø‘í¹˜¹™½Éµ…Ð¡½™™Í•Ð€¬¥¹‘•à€¬€Ä¥ôð½ÑøñÑøñÍÑÉ½¹œø‘í•ÍŒ¡¥Ñ•´¹Á¹¼¥ôð½ÍÑÉ½¹œøñÍµ…±°û‚æ‚âk‚æ‚â‚â‚âÓ‚æ'‚âè€‘í•ÍŒ¡¥Ñ•´¹‰…­¥¹9¼ñð€ˆ´ˆ¥ôð½Íµ…±°øð½ÑøñÑøñÍÑÉ½¹œø‘í•ÍŒ¡…Ñ•½Éä¥ôð½ÍÑÉ½¹œøñÍµ…±°û‚â‹‚âß‚âg‚â‹‚âÇ‚âg‚â#‚âË‚â	$‘•Ñ…¥°ÑåÁ”ô‘í•ÍŒ¡ÑåÁ”¥ôð½Íµ…±°øð½ÑøñÑøñÍÑÉ½¹œø‘í•ÍŒ¡¥Ñ•´¹±…ÍÑÑ¥½¸ñð¥Ñ•´¹ÍÑ…ÑÕÌñð€ˆ´ˆ¥ôð½ÍÑÉ½¹œøñÍµ…±°ø‘í•ÍŒ¡¥Ñ•´¹±…ÍÑÑ¥½¹Ðñð€ˆ´ˆ¥ôð½Íµ…±°øð½ÑøñÑøñÍÑÉ½¹œø‘í•ÍŒ¡¥Ñ•´¹Ñ…É•Ñ!Õˆñð€ˆ´ˆ¥ôð½ÍÑÉ½¹œøñÍµ…±°ø‘í•ÍŒ¡¥Ñ•´¹Ñ…É•Ñ	É…¹ ñð€ˆ´ˆ¥ôð½Íµ…±°øð½Ñøð½ÑÈù€¤¹©½¥¸ ˆˆ¥ôð½Ñ‰½‘äøð½Ñ…‰±”œ°(€€€€œñÑ…‰±”øñÑ¡•…øñÑÈøñÑ û‚â—‚âÏ‚âS‚âÇ‚âhð½Ñ øñÑ ùA9<ð½Ñ øñÑ ù	…­¥¹œ€¼	…¥¹œð½Ñ øñÑ û‚â«‚â[‚âË‚âg‚âÀA9<ð½Ñ øñÑ û‚â‚âË‚â‚âS‚âÏ‚æ‚âg‚âÓ‚âg‚â‚âË‚â‚â—‚æ#‚âË‚â«‚âã‚âP€¼ƒ‚æ‚âŸ‚â—‚âÈð½Ñ øñÑ ù!U€¼ƒ‚â«‚âË‚â‚âÈð½Ñ øð½ÑÈøð½Ñ¡•…øñÑ‰½‘äø‘íÁ•¹‘¥¹A…É•±I½ÝÌ¹µ…À ¡¥Ñ•´°¥¹‘•à¤€ôø€ñÑÈøñÑø‘í¹˜¹™½Éµ…Ð¡½™™Í•Ð€¬¥¹‘•à€¬€Ä¥ôð½ÑøñÑøñÍÑÉ½¹œø‘í•ÍŒ¡¥Ñ•´¹Á¹¼ñð€ˆ´ˆ¥ôð½ÍÑÉ½¹œøð½ÑøñÑøñÍÑÉ½¹œø‘í•ÍŒ¡¥Ñ•´¹‰…­¥¹9¼ñð€ˆ´ˆ¥ôð½ÍÑÉ½¹œøð½ÑøñÑøñÍÑÉ½¹œø‘í•ÍŒ¡…Ñ•½Éä¥ôð½ÍÑÉ½¹œøñÍµ…±°û‚â‹‚âß‚âg‚â‹‚âÇ‚âg‚â#‚âË‚âd$’FWF–ÂG—SÒG¶W62‡G—R—ÓÂ÷6ÖÆÃãÂ÷FCãÇFCãÇ7G&öæsâG¶W62†—FVÒæÆ7D7F–öâÇÂ—FVÒç7FGW2ÇÂ"Ò"—ÓÂ÷7G&öæsãÇ6ÖÆÃâG¶W62†—FVÒæÆ7D7F–öäBÇÂ"Ò"—ÓÂ÷6ÖÆÃãÂ÷FCãÇFCãÇ7G&öæsâG¶W62†—FVÒçF&vWD‡V"ÇÂ"Ò"—ÓÂ÷7G&öæsãÇ6ÖÆÃâG¶W62†—FVÒçF&vWD'&æ6‚ÇÂ"Ò"—ÓÂ÷6ÖÆÃãÂ÷FCãÂ÷G#æ’æ¦ö–â‚""—ÓÂ÷F&öG“ãÂ÷F&ÆRrÀ¢'&÷VæC"6W&FR&6¶–ær6öÇVÖâ"À¢“° ¢÷WGWBÒ&WÆ6Töæ6R€¢÷WGWBÀ¢rv—Bæf–vF÷"æ6Æ—&ö&Bçw&—FUFW‡B‡&÷w2æÖ‚‡&÷r’Óâ&÷rçæò’æ¦ö–â‚%ÅÆâ"’“µÆâFö7B†ˆN‹‰NŠ^ŠÞˆäò‰~‹^˜Ž˜.Š¾Š^‰N˜Š^˜žŠrG¶æbæf÷&ÖB‡&÷w2æÆVæwF‚—ÒŠ>‹.Š.ˆ‹.Š>˜Š^˜žŠv“²rÀ¢rv—Bæf–vF÷"æ6Æ—&ö&Bçw&—FUFW‡B‡&÷w2æÖ‚‡&÷r’ÓâG·&÷rçæòÇÂ"'ÕÅÇBG·&÷ræ&6¶–ætæòÇÂ"'Ö’æ¦ö–â‚%ÅÆâ"’“µÆâFö7B†ˆN‹‰NŠ^ŠÞˆäò²&6¶–ær‰~‹^˜Ž˜.Š¾Š^‰N˜Š^˜žŠrG¶æbæf÷&ÖB‡&÷w2æÆVæwF‚—ÒŠ>‹.Š.ˆ‹.Š>˜Š^˜žŠv“²rÀ¢'&÷VæC"6÷’&6¶–ær"À¢“° ¢÷WGWBÒ&WÆ6Töæ6R†÷WGWBÂr.˜Š^ˆ.˜‰®˜~ˆˆ‹N˜žˆr#¢&÷ræ&6¶–ætæòÇÂ""rÂr$&6¶–ærò&vv–ær#¢&÷ræ&6¶–ætæòÇÂ""rÂ'&÷VæC"W‡÷'B&6¶–ærÆ&VÂ"“° ¢òòÆFW7B66WFVBc‚ÆWGFRæB&öw&W72&V†f–÷"à¢÷WGWBÒ&WÆ6Töæ6R†÷WGWBÂr&6¶w&÷VæC¢6V6VVV#²rÂr&6¶w&÷VæC¢6SVS†V²rÂ'&÷VæC"c‚G&6²"“°¢÷WGWBÒ&WÆ6Töæ6R†÷WGWBÂr&6¶w&÷VæC¢6CsCC6S²rÂr&6¶w&÷VæC¢Æ–æV"Öw&F–VçBƒ“FVrÂ6#“6&bÂ6SCfVR“²rÂ'&÷VæC"c‚&VB"“°¢÷WGWBÒ&WÆ6Töæ6R†÷WGWBÂræ×2×vRçæò×7VÖÖ'’æ—2ÖÖ&W"çæò×&öw&W72Öf–ÆÂ²&6¶w&÷VæC¢6C“–ƒ²ÒrÂræ×2×vRçæò×7VÖÖ'’æ—2ÖÖ&W"çæò×&öw&W72Öf–ÆÂ²&6¶w&÷VæC¢Æ–æV"Öw&F–VçBƒ“FVrÂ6#ƒs“Â6c#S2“²ÒrÂ'&÷VæC"c‚Ö&W""“°¢÷WGWBÒ&WÆ6Töæ6R†÷WGWBÂræ×2×vRçæò×7VÖÖ'’æ—2Öw&VVâçæò×&öw&W72Öf–ÆÂ²&6¶w&÷VæC¢3sV#Cvc²ÒrÂræ×2×vRçæò×7VÖÖ'’æ—2Öw&VVâçæò×&öw&W72Öf–ÆÂ²&6¶w&÷VæC¢Æ–æV"Öw&F–VçBƒ“FVrÂ36#†#S‚Â3sF&c†B“²ÒrÂ'&÷VæC"c‚w&VVâ"“°¢÷WGWBÒ&WÆ6Töæ6R†÷WGWBÂræ×2×vRçæò×7VÖÖ'’æ—2Ö6ö×ÆWFRçæò×&öw&W72Öf–ÆÂ²&6¶w&÷VæC¢36C†CSc²ÒrÂræ×2×vRçæò×7VÖÖ'’æ—2Ö6ö×ÆWFRçæò×&öw&W72Öf–ÆÂ²&6¶w&÷VæC¢Æ–æV"Öw&F–VçBƒ“FVrÂ3##C#‚RÂ333c6S‚RÂ36#CCRƒ"RÂ6#C†c“BRÂ6ffCC&bR“²ÒrÂ'&÷VæC"c‚6ö×ÆWFR"“°¢÷WGWBÒ&WÆ6Töæ6R†÷WGWBÂr&6¶w&÷VæC¢3S3S“S3²rÂr&6¶w&÷VæC¢333c3ƒ²rÂ'&÷VæC"c‚Ö&¶W""“° ¢òòÖ&¶W"—2–ç6W'FVB–âW†V7WF&ÆR6÷W&6R&F†W"F†â5526ò–FV×÷FVæ7’—2W‡Æ–6—Bà¢÷WGWBÒ&WÆ6Töæ6R€¢÷WGWBÀ¢vgVæ7F–öâæõ&öw&W757FGW2‡W&6VçB’²rÀ¢òòG´e$ôåDTäEôÔ$´U'Ó¢ÆFW7B66WFVBc‚7FGW2ÆWGFR²&6¶–ærô&vv–ær&W6VçFF–öâåÆægVæ7F–öâæõ&öw&W757FGW2‡W&6VçB’¶À¢'&÷VæC"g&öçFVæBÖ&¶W""À¢“°¢&WGW&â÷WGWC°§Ð