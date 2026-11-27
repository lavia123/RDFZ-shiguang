import type { FoundModel } from "../hooks/useFound";
import { CONTACT_TYPES, FIXED_OFFICE } from "../../shared/constants";
import { formatReviewIssue } from "../../shared/review-labels";
import type { ReviewIssue } from "../../shared/identity";

function FieldIssue({
  field,
  issues,
}: {
  field: string;
  issues: ReviewIssue[];
}) {
  const rows = issues.filter((issue) => issue.field === field);
  if (!rows.length) return null;
  return (
    <span className="field-error">
      {rows.map((issue) => issue.message).join("；")}
    </span>
  );
}
export function FoundPanel({
  active,
  m,
  notify,
}: {
  active: boolean;
  m: FoundModel;
  notify: (text: string) => void;
}) {
  return (
    <section className={"panel" + (active ? " active" : "")} id="panel-found">
      <div className="panel-head">
        <h1>我捡到了</h1>
        <p>拍一张照片，写清楚是什么。东西统一交到逸夫楼316。</p>
      </div>
      <div className="found-grid">
        <div className="camera-box">
          <div className="preview-wrap">
            <video
              id="video"
              playsInline
              muted
              ref={m.videoRef}
              className={m.live ? "live" : ""}
            ></video>
            <img
              id="previewImg"
              alt="物品预览"
              src={m.image || undefined}
              className={m.image && !m.live ? "show" : ""}
            />
            <div
              className="preview-placeholder"
              id="previewHint"
              hidden={!!m.image || m.live}
            >
              <strong>先拍一张</strong>
              打开摄像头拍照，或者从相册选一张
            </div>
          </div>
          <div className="cam-actions">
            <button
              type="button"
              className={m.live ? "btn btn-ghost" : "btn btn-primary"}
              id="btnCamera"
              onClick={() => {
                if (m.live) {
                  m.stopCamera();
                  notify("摄像头已关闭");
                } else void m.startCamera();
              }}
            >
              {m.live ? "关掉摄像头" : "打开摄像头"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              id="btnCapture"
              disabled={!m.live}
              onClick={m.capture}
            >
              拍照
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              id="btnPick"
              onClick={() => m.fileRef.current?.click()}
            >
              从相册选择
            </button>
            <input
              type="file"
              id="fileInput"
              className="file-input-hidden"
              accept="image/*"
              tabIndex={-1}
              aria-hidden="true"
              ref={m.fileRef}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file) void m.pick(file);
              }}
            />
          </div>
          <div className="ai-box">
            <div className="ai-box-head">
              <div className="label">照片说明</div>
            </div>
            <div
              className={"ai-status" + (m.thinking ? " thinking" : "")}
              id="aiStatus"
            >
              {m.status}
            </div>
          </div>
        </div>

        <form
          className="form-fields"
          id="foundForm"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void m.submit();
          }}
        >
          <input type="hidden" id="editId" value={m.editId} />
          <div className="text-fill-panel">
            <p className="hint">
              想少打字？把一段话贴在下面，点按钮。只会填「在哪捡到的」，不会改领取地点，也不用写联系人。
            </p>
            <textarea
              id="fillText"
              rows={2}
              placeholder="例如：我在图书馆二楼自习室捡到一个蓝色水杯"
              value={m.fillText}
              onChange={(e) => m.setFillText(e.currentTarget.value)}
            ></textarea>
            <button
              type="button"
              className="btn btn-ghost btn-text-extract"
              id="btnTextExtract"
              disabled={m.fillBusy}
              onClick={() => void m.extract()}
            >
              {m.fillBusy ? "正在填写…" : "提取关键信息"}
            </button>
          </div>
          {m.reviewIssues.length > 0 && (
            <div className="review-issues" role="alert">
              <strong>这里需要改</strong>
              <ul>
                {m.reviewIssues.map((issue, index) => (
                  <li key={`${issue.field}-${index}`}>
                    {formatReviewIssue(issue)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <FieldIssue field="image" issues={m.reviewIssues} />
          <label>
            物品描述
            <span className="hint">写清颜色和样子，别人才能认出来。拍照后也可能自动填上，你可以改。</span>
            <textarea
              id="description"
              placeholder="例如：粉色水杯，杯身写着 1356"
              value={m.form.description}
              onChange={(e) => m.setField("description", e.currentTarget.value)}
              aria-invalid={m.reviewIssues.some((i) => i.field === "description")}
            ></textarea>
            <FieldIssue field="description" issues={m.reviewIssues} />
          </label>
          <div>
            <span className="field-label">领取地点</span>
            <p className="office-fixed" id="office">
              {FIXED_OFFICE}
            </p>
            <span className="hint">全校都交到这里，不用自己填。</span>
          </div>
          <label>
            在哪捡到的（可不填）
            <input
              id="place"
              placeholder="例如：图书馆二楼自习室"
              value={m.form.place}
              onChange={(e) => m.setField("place", e.currentTarget.value)}
              aria-invalid={m.reviewIssues.some((i) => i.field === "place")}
            />
            <FieldIssue field="place" issues={m.reviewIssues} />
          </label>
          <label>
            联系方式（可不填）
            <span className="hint">名字已经用学校账号了。想留电话或微信可以填，不填也行。</span>
            <div className="contact-row">
              <select
                id="contactType"
                aria-label="联系方式类型"
                value={m.form.contactType}
                onChange={(e) =>
                  m.setField("contactType", e.currentTarget.value)
                }
              >
                <option value="">类型</option>
                {CONTACT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <input
                id="contactValue"
                placeholder="填写对应号码或账号"
                value={m.form.contactValue}
                onChange={(e) =>
                  m.setField("contactValue", e.currentTarget.value)
                }
              />
            </div>
            <FieldIssue field="contactValue" issues={m.reviewIssues} />
          </label>
          <label>
            再补一句（可不填）
            <input
              id="note"
              placeholder="例如：杯盖单独放着"
              value={m.form.note}
              onChange={(e) => m.setField("note", e.currentTarget.value)}
            />
          </label>
          <button
            type="submit"
            className="btn btn-accent"
            id="btnSubmit"
            disabled={m.busy}
          >
            {m.busy ? "正在提交…" : m.editId ? "保存修改" : "发布招领"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            id="btnCancelEdit"
            hidden={!m.editId}
            onClick={() => {
              m.reset();
              notify("已取消修改");
            }}
          >
            取消修改
          </button>
        </form>
      </div>
    </section>
  );
}
