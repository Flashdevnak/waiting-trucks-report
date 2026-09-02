import {
  patchMsRouteCancellationFrontend as patchFrontendBase,
  patchMsRouteCancellationStyle,
  patchMsRouteCancellationWorker,
} from "./patch-ms-route-cancellation.mjs";

const DESKTOP_WORK_STATUS_ANCHOR =
  `  const workStatus = isDestination(row)\n    ? row.loadStatus || status.label`;

export function patchMsRouteCancellationFrontend(source) {
  const originalLastIndexOf = String.prototype.lastIndexOf;
  String.prototype.lastIndexOf = function (searchValue, position) {
    if (searchValue === DESKTOP_WORK_STATUS_ANCHOR)
      return this.indexOf(searchValue);
    return originalLastIndexOf.call(this, searchValue, position);
  };
  try {
    return patchFrontendBase(source);
  } finally {
    String.prototype.lastIndexOf = originalLastIndexOf;
  }
}

export { patchMsRouteCancellationStyle, patchMsRouteCancellationWorker };
