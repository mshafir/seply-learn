// Every job kind this server runs. Each runtime's engine and the API share
// it. The build (WP-3.5b) and the writers (WP-3.6) add theirs here.
import { fakeJob } from "./fake.ts"
import { jobRegistry } from "./types.ts"

export const JOB_KINDS = jobRegistry(fakeJob)
