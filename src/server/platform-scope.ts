import { AsyncLocalStorage } from "node:async_hooks";
import type { CurrentActor } from "../shared/identity.js";
import { HttpError } from "./errors.js";

export interface PlatformScope {
  requestId: string;
  actor: CurrentActor;
  schoolId: string;
  dataRoot: string;
  classIds: string[] | null;
  canManageSchoolRecords?: boolean;
  signal: AbortSignal;
}
export const platformScope = new AsyncLocalStorage<PlatformScope>();
export function visibleInScope(
  classId: string | undefined,
  schoolRecord?: true,
) {
  const scope = platformScope.getStore();
  return (
    !scope ||
    (schoolRecord === true
      ? scope.classIds === null || scope.canManageSchoolRecords === true
      : !!classId &&
        (scope.classIds === null || scope.classIds.includes(classId)))
  );
}
export function assertInScope(
  classId: string | undefined,
  schoolRecord?: true,
) {
  if (!visibleInScope(classId, schoolRecord))
    throw new HttpError(404, "记录不存在");
}
/** Preserve stored scope; clients cannot promote a class record to school scope. */
export function retainRecordScope(
  current: { ownerClassId?: string; schoolRecord?: true } | null,
  next: { ownerClassId?: string; schoolRecord?: true },
) {
  if (current?.schoolRecord === true) {
    next.schoolRecord = true;
    delete next.ownerClassId;
  } else {
    delete next.schoolRecord;
    next.ownerClassId = current?.ownerClassId ?? newRecordClass();
  }
}
export function newRecordClass() {
  const scope = platformScope.getStore();
  if (!scope) return undefined;
  const id = scope.actor.classId;
  if (!id || (scope.classIds !== null && !scope.classIds.includes(id)))
    throw new HttpError(403, "当前身份没有班级使用权限");
  return id;
}
