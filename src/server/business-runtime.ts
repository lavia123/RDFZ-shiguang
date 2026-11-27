import express from "express";
import type { Config } from "./config.js";
import { FileStore } from "./storage.js";
import { createApp } from "./app.js";
import { resolveActor as nativeActor } from "./auth.js";
import {
  createLostMatching,
  type LostMatchingHandles,
} from "./lost-matching/mount.js";
import { createDefaultReviewer } from "./moderation/review.js";
import { isApprovedVersion, type ReviewCandidate } from "../shared/identity.js";
import {
  lookupDevelopmentStudent,
  DEVELOPMENT_STATIONS,
} from "./development-identity.js";
import { lookupPlatformStudent } from "./platform-bridge.js";
import { platformScope } from "./platform-scope.js";

export async function createBusinessRuntime(
  config: Config,
  mode: NonNullable<Config["identityMode"]>,
) {
  const scoped = mode !== "standalone";
  const store = await new FileStore(config.dataDir).acquire();
  let matching: LostMatchingHandles | undefined;
  try {
    const review = createDefaultReviewer(config);
    const reviewer = (
      candidate: Pick<ReviewCandidate, "kind" | "revision"> &
        Partial<Pick<ReviewCandidate, "texts" | "images">> & {
          textFields?: Record<string, string>;
          imageRef?: string;
        },
    ) =>
      review({
        kind: candidate.kind,
        revision: candidate.revision,
        textFields: candidate.textFields || candidate.texts || {},
        imageRef:
          candidate.imageRef ||
          candidate.images?.find((name) => name.startsWith("staging_")) ||
          candidate.images?.[0],
      });
    const actor = () =>
      platformScope.getStore()?.actor ?? { kind: "guest" as const };
    const router = express.Router();
    router.use(express.json({ limit: "2mb" }));
    matching = await createLostMatching({
      config,
      store,
      reviewSubmission: reviewer,
      isApprovedVersion,
      resolveActor: scoped
        ? actor
        : ({ header }) =>
            nativeActor(
              { header } as Parameters<typeof nativeActor>[0],
              config,
            ),
    });
    matching.mountRoutes(router);
    router.use(
      createApp(
        config,
        store,
        fetch,
        scoped
          ? {
              resolveActor: actor,
              stations: mode === "development" ? DEVELOPMENT_STATIONS : [],
              lookupStudent:
                mode === "platform"
                  ? lookupPlatformStudent
                  : lookupDevelopmentStudent,
              reviewSubmission: reviewer,
              provenance: mode === "platform" ? "platform" : "test",
            }
          : { reviewSubmission: reviewer },
      ),
    );
    // Automatic matching belongs to this school's storage, not the first request's class.
    platformScope.exit(() => matching!.scheduler.start());
    return {
      router,
      async close() {
        await matching!.scheduler.stop();
        await store.close();
      },
    };
  } catch (error) {
    await matching?.scheduler.stop();
    await store.close();
    throw error;
  }
}
