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
import { lookupPlatformStudent } from "./platform-bridge.js";
import { platformScope } from "./platform-scope.js";

export async function createBusinessRuntime(config: Config, platform: boolean) {
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
      resolveActor: platform
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
        platform
          ? {
              resolveActor: actor,
              lookupStudent: lookupPlatformStudent,
              reviewSubmission: reviewer,
              provenance: "platform",
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
