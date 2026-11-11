import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Job } from "@server/types";
import { qk } from "./api";

/** Subscribes to the server's SSE stream and keeps the query cache live. */
export function useServerEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      es = new EventSource("/api/events");
      es.addEventListener("hello", () => {
        // resync after (re)connecting
        qc.invalidateQueries({ queryKey: qk.jobs });
        qc.invalidateQueries({ queryKey: qk.meetings });
      });
      es.addEventListener("job", (e) => {
        const { job } = JSON.parse((e as MessageEvent).data) as { job: Job };
        qc.setQueryData<Job[]>(qk.jobs, (old = []) => {
          const i = old.findIndex((j) => j.id === job.id);
          if (i < 0) return [job, ...old];
          const next = old.slice();
          next[i] = job;
          return next;
        });
        const finished = job.status === "done" || job.status === "failed" || job.status === "canceled";
        if (job.meeting_id && finished) qc.invalidateQueries({ queryKey: qk.meeting(job.meeting_id) });
      });
      es.addEventListener("meetings", () => {
        qc.invalidateQueries({ queryKey: qk.meetings });
        // status of the open meeting (queued -> processing -> ready) changes with the list
        qc.invalidateQueries({ queryKey: ["meeting"] });
      });
      es.onerror = () => {
        es?.close();
        retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      clearTimeout(retry);
      es?.close();
    };
  }, [qc]);
}
