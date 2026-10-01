// Every job kind this server runs. Each runtime's engine and the API share
// it.
import { buildJob } from "./build.ts"
import { fakeJob } from "./fake.ts"
import { growJob } from "./grow.ts"
import { jobRegistry } from "./types.ts"
import { articleJob } from "./writers.ts"

export const JOB_KINDS = jobRegistry(buildJob, articleJob, growJob, fakeJob)
