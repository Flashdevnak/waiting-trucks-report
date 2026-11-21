# WTR-011P — Consolidated Owner decision

**BLOCKED before DEV Dispatch.** This is the single decision record for the remaining credential and release gates. Owner authorization for WTR-012 covers the Brain branch and offline work.

## Exact DEV compatibility barrier

At PR #122's DEV merge `c090743b174a18e32d5bb93ee649e3d70fff3210`, the workflow used the legacy Cloudflare Token as a job variable. After PR #123 at `afbe6e0e57b5d0a752303e39846538a439dda27d`, credentials are step-scoped. Protected dependency preparation has no Cloudflare Token. Publish uses `CLOUDFLARE_DEV_PUBLISH_API_TOKEN`; metadata/version/Tail steps use `CLOUDFLARE_DEV_OBSERVABILITY_API_TOKEN`. Both names were absent at the latest separate CRED-002 settings check. This checkpoint does not infer provider access from a secret name. The same DEV target, identity verification, ref guard, exact staged bytes and Sealed Publisher apply. [PR #123 diff](https://github.com/Flashdevnak/waiting-trucks-report/pull/123/files)

Offline GitHub evidence records real Wrangler 4.127.1 sending `POST .../assets-upload-session`, `GET /workers/subdomain` and a Worker multipart `PUT` against the isolated loopback mock. Cloudflare API documentation includes Individual Workers Editor for version upload/deployment. Accepted permissions for the asset session list Workers Scripts Write or Workers Admin rather than the individual role, and Workers Subdomain documents account/Workers-level permissions. This is a documented authorization gap for the actual flow. No live scoped-token attempt or HTTP denial is claimed. [Runner evidence](https://github.com/Flashdevnak/waiting-trucks-report/actions/runs/44848641565/job/136674466173) · [Asset session](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/assets/subresources/upload/methods/create/) · [Workers Subdomain](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/) · [Create deployment](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/)

**Minimum recovery path:** Get a provider-supported account-owned policy limited to `waiting-trucks-report-api-dev` that covers every required operation. Ask Cloudflare to confirm or support the asset session and Wrangler account lookup under the individual role. Separately confirm the least-privilege read-only scope for Worker secret names/types, version details, deployments and Tail. The provider's Tail and Version Detail endpoint documentation does not establish that a single DEV-scoped metadata role covers both. Once supported, retain the existing workflow and have the Owner provision the two already-named Secrets. If a scoped policy cannot be established, the current release remains blocked. No compatibility patch, legacy token fallback, source rewrite or Draft PR is needed for this checkpoint. [Workers permissions](https://developers.cloudflare.com/workers/authorization/) · [Version Detail](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/) · [Start Tail](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/tail/methods/create/)

The original Node 22/Wrangler CI remains accepted for offline source and byte identity. WTR-012 verifies the workflow credential mapping/ref guard and unchanged pins offline; it does not rerun the accepted upstream CI or mark provider acceptance complete.

## One approval record for Owner

1. Record Cloudflare's answer for the scoped Publish and Observability operations. With documented effective rights, confirm both newly provisioned Secret names, expiry, and policy-to-secret binding by authorized Owner. Keep credential values out of GitHub records and chat.
2. Name and confirm the credentialed DEV rollback operator and approved rollback authority for the window. Version 650 was found in the earlier deployable list; current read-only traffic confirms the rollback baseline. Confirm WTR-011P rollback separately from release if the decision structure requires it.
3. Accept or decline the step-level credential risk in the shared runner job. Sealed publisher guard and step-level scoping stay in force; an earlier same-job process can affect later steps. If declined, keep the gate closed pending separately authorized mitigation.
4. Only after the above conditions, record exact Owner DEV dispatch approval for this worker and these pins. Recheck commit, permissions, expiry, currently active Worker, and rollback readiness before dispatch.

| Workflow input | Verified candidate value |
|---|---|
| approved_source_sha | `afbe6e0e57b5d0a752303e39846538a439dda27d` |
| approved_identity_kind | `candidate` |
| approved_identity_sha256 | `638e85deb366e492108d0592eafadfc2f9ff0920c82215bee2e40b8d7ae26a4c` |
| approved_publisher_scope_sha256 | `b9adc671227509f8ed88b06ce55d70d077df237aa9e49eab48f7ea1740f36bec` |

Golden manifest SHA-256 `7b3e557cdb7e481a0eafc798e2f4f06115d9f4d792cf52bf39fcc0b975aa0c30`. Sealed Publisher SHA-256 `0e34d8404327927cdbed614eb0e47dfced9a9c454390ec585f0b685190a38f58`. Deploy Workflow SHA-256 `665b88b3cb81a74e3c0c0941539250da8340926530da3eaa9127148c618b2c78`. Rollback baseline UUID `1e8e7e6a-95b5-40d1-ba8d-5c6fbf763637`. Confirm Worker version and traffic, Turso/D1 bindings, exact assets and H-only arrival behavior after any separately authorized deploy.

I03 offline ACCEPTED. Provider acceptance OPEN. Production RELEASE HOLD.
