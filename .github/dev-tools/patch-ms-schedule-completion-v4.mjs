function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  if (first < 0 || first !== output.lastIndexOf(from))
    throw new Error(`MS Schedule completion V4 patch failed: ${label}`);
  return output.replace(from, to);
}

export function patchMsScheduleCompletionV4(source) {
  let output = String(source || "");
  if (output.includes("MS_SCHEDULE_COMPLETION_TRUTH_V4")) return output;
  output = replaceUnique(
    output,
    `        AND COALESCE(h2.event_type,'UPDATED')<>'FIRST_SEEN'
        AND COALESCE(h2.synced_by,'')<>'MS_RANGE'
        AND COALESCE(json_extract(h2.payload_json,'$.unloadingCompletedAt'),'')<>''
        AND CAST(json_extract((
          SELECT h1.payload_json
          FROM ms_route_history h1
          WHERE h1.hub=h2.hub
            AND h1.route_id=h2.route_id
            AND json_valid(h1.payload_json)=1
            AND (h1.snapshot_at<h2.snapshot_at OR (h1.snapshot_at=h2.snapshot_at AND h1.rowid<h2.rowid))
          ORDER BY h1.snapshot_at DESC,h1.rowid DESC
          LIMIT 1
        ),'$.unloadingState') AS INTEGER) IN (0,1)`,
    `        AND COALESCE(json_extract(h2.payload_json,'$.unloadingCompletedAt'),'')<>''
        AND (
          json_extract(h2.payload_json,'$.completionSource')='SCHEDULE'
          OR (
            COALESCE(h2.event_type,'UPDATED')<>'FIRST_SEEN'
            AND COALESCE(h2.synced_by,'')<>'MS_RANGE'
            AND CAST(json_extract((
              SELECT h1.payload_json
              FROM ms_route_history h1
              WHERE h1.hub=h2.hub
                AND h1.route_id=h2.route_id
                AND json_valid(h1.payload_json)=1
                AND (h1.snapshot_at<h2.snapshot_at OR (h1.snapshot_at=h2.snapshot_at AND h1.rowid<h2.rowid))
              ORDER BY h1.snapshot_at DESC,h1.rowid DESC
              LIMIT 1
            ),'$.unloadingState') AS INTEGER) IN (0,1)
          )
        )`,
    "allow authoritative Schedule E or a proven Route transition",
  );
  return output.replace(
    "// MS_COMPLETION_TIME_TRUTH_V2:",
    "// MS_SCHEDULE_COMPLETION_TRUTH_V4: Route owns status; Schedule E owns a safely matched completion timestamp.\n// MS_COMPLETION_TIME_TRUTH_V2:",
  );
}
