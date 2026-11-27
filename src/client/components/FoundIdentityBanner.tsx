import { foundFormContext, type SessionView } from "../../shared/identity";
export function FoundIdentityBanner({ session }: { session: SessionView }) {
  const form = foundFormContext(session);
  if (form.mode === "guest") return null;
  if (form.mode === "kiosk")
    return (
      <p className="identity-banner" id="foundIdentity" data-found-mode="kiosk">
        这是公共电脑：{form.stationName || "未命名站点"}
        。不用填自己的名字。发完、点结束，或两分钟没操作，这次填写会清掉。
      </p>
    );
  return (
    <p
      className="identity-banner"
      id="foundIdentity"
      data-found-mode={form.mode}
    >
      {session.provenance === "test"
        ? "使用本地测试身份发布："
        : "用你的学校账号发布："}
      {form.displayName || "未命名"} · {form.className || "未分班"}
      。不用再填姓名和手机号。
    </p>
  );
}
