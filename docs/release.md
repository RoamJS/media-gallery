# Release process

Merging to `main` validates the extension only. Neither workflow publishes a
GitHub release, uploads to S3, nor creates or updates a Roam Depot pull request.
The manual **Validate Main** action runs the same validation checks.

Both workflows install locked dependencies, typecheck, run tests, and invoke
`npm run build:roam`. That script uses `samepage build --dry`, which builds the
extension and semantic worker without entering Samepage's publishing phase.
The workflows have read-only repository permissions and no release or AWS
credentials. Checkout does not persist Git credentials.

## Before publishing

1. Review the release candidate and record the exact commit and bundle hashes.
2. Run the test, typecheck, and dry-build checks, then verify that build in an
   authenticated Roam session. Check both ordinary gallery use and opt-in semantic
   search, including the worker loading path used by the distributed bundle.
3. Finalize the changelog and user documentation for the selected version.
4. Obtain explicit approval for publishing the release and for submitting the
   Roam Depot change. A source merge does not perform either action.

There is deliberately no publishing GitHub Action in this repository. Prepare
and review the release assets and Depot manifest as separate release work.

Do not use bare `samepage build` as a validation command. The inherited
`roamjs-components` configuration supplies a `review` hook that invokes
`publishToRoamDepot.js` during a non-dry build on `main`. That hook can create or
update a Depot pull request, in addition to the build's other publishing actions.
