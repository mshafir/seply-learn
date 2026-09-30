// Every job kind this server runs. Each runtime's engine and the API share
// it. The writers (WP-3.6) add theirs here.
import { buildJob } from "./build.ts"
import { fakeJob } from "./fake.ts"
import { jobRegistry } from "./types.ts"

export const JOB_KINDS = jobRegistry(buildJob, fakeJob)
