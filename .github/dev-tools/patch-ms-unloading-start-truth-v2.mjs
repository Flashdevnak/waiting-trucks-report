import {
  patchMsUnloadingStartTruthFrontend as patchMsUnloadingStartTruthFrontendV2,
  patchMsUnloadingStartTruthWorker as patchMsUnloadingStartTruthWorkerV2,
} from "./patch-ms-unloading-start-truth-v2-base.mjs";
import { patchMsOperationalExpiryAnchorV2Frontend } from "./patch-ms-operational-expiry-anchor-v2.mjs";
import { patchMsOriginArrivalSourcesV1 } from "./patch-ms-origin-arrival-sources-v1.mjs";
import { patchMsDropReleasePairV1Frontend } from "./patch-ms-drop-release-pair-v1.mjs";
import {
  patchMsLowerCardTruthFrontend,
  patchMsLowerCardTruthWorker,
} from "./patch-ms-lower-card-truth-v1.mjs";

export function patchMsUnloadingStartTruthFrontend(source) {
  return patchMsLowerCardTruthFrontend(
    patchMsDropReleasePairV1Frontend(
      patchMsOriginArrivalSourcesV1(
        patchMsOperationalExpiryAnchorV2Frontend(
          patchMsUnloadingStartTruthFrontendV2(source),
        ),
      ),
    ),
  );
}

export function patchMsUnloadingStartTruthWorker(source) {
  return patchMsLowerCardTruthWorker(
    patchMsUnloadingStartTruthWorkerV2(source),
  );
}
