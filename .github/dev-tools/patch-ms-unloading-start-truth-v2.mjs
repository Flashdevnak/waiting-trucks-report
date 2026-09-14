import {
  patchMsUnloadingStartTruthFrontend as patchMsUnloadingStartTruthFrontendV2,
  patchMsUnloadingStartTruthWorker,
} from "./patch-ms-unloading-start-truth-v2-base.mjs";
import { patchMsOperationalExpiryAnchorV2Frontend } from "./patch-ms-operational-expiry-anchor-v2.mjs";

export function patchMsUnloadingStartTruthFrontend(source) {
  return patchMsOperationalExpiryAnchorV2Frontend(
    patchMsUnloadingStartTruthFrontendV2(source),
  );
}

export { patchMsUnloadingStartTruthWorker };
