import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Telegram retries an update for at most a day; older dedup records are useless.
crons.daily("prune telegram updates", { hourUTC: 3, minuteUTC: 17 }, internal.telegram.pruneUpdates, {});

export default crons;
