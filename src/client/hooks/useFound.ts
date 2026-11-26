import {
  cameraAvailabilityMessage,
  cameraErrorMessage,
  openCamera,
} from "../camera";
import { appUrl } from "../paths";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiStatus, FillFields, Item } from "../../shared/types";
import { FIXED_OFFICE, CONTACT_TYPES } from "../../shared/constants";
import { ApiError, api, getPublisherId, message } from "../api";
import type { ReviewIssue } from "../../shared/publication";
import { compressImage, dataUrlToBlob, runLocalFallback } from "../images";
import { localExtractFillFields } from "../recognition";
const empty = {
  description: "",
  place: "",
  office: FIXED_OFFICE,
  note: "",
  contact: "",
  contactType: "",
  contactValue: "",
};
export function useFound(
  ai: AiStatus,
  notify: (text: string) => void,
  onPublished: () => Promise<void>,
) {
  const [form, setForm] = useState(empty),
    [editId, setEditId] = useState(""),
    [image, setImage] = useState(""),
    [live, setLive] = useState(false),
    [busy, setBusy] = useState(false),
    [fillBusy, setFillBusy] = useState(false),
    [fillText, setFillText] = useState(""),
    [status, setStatus] = useState(""),
    [thinking, setThinking] = useState(false),
    [reviewIssues, setReviewIssues] = useState<ReviewIssue[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    stream = useRef<MediaStream | null>(null),
    blob = useRef<Blob | null>(null),
    generation = useRef(0),
    request = useRef<AbortController | null>(null),
    fillRequest = useRef<AbortController | null>(null),
    submitting = useRef(false),
    filling = useRef(false),
    mounted = useRef(true),
    cameraGeneration = useRef(0);
  const setField = (key: keyof typeof empty, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const stopCamera = useCallback(() => {
    cameraGeneration.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
  }, []);
  const cancel = useCallback(() => {
    generation.current++;
    request.current?.abort();
    fillRequest.current?.abort();
    filling.current = false;
    setFillBusy(false);
    setThinking(false);
    stopCamera();
  }, [stopCamera]);
  const dispose = useCallback(() => {
    mounted.current = false;
    generation.current++;
    cameraGeneration.current++;
    request.current?.abort();
    fillRequest.current?.abort();
    stream.current?.getTracks().forEach((t) => t.stop());
  }, []);
  useEffect(() => {
    mounted.current = true;
    return dispose;
  }, [dispose]);
  const reset = () => {
    cancel();
    setForm(empty);
    setEditId("");
    setImage("");
    blob.current = null;
    setFillText("");
    setStatus("");
    setReviewIssues([]);
  };
  async function startCamera() {
    stopCamera();
    const token = ++cameraGeneration.current;
    const unavailable = cameraAvailabilityMessage();
    if (unavailable) {
      notify(unavailable);
      return;
    }
    const video = videoRef.current;
    if (!video) {
      notify("拍摄区域尚未就绪，请重试");
      return;
    }
    try {
      const next = await openCamera(
        video,
        () => token === cameraGeneration.current && mounted.current,
        (acquired) => {
          stream.current = acquired;
        },
      );
      if (!next) return;
      setLive(true);
      notify("摄像头已打开");
    } catch (error) {
      if (token === cameraGeneration.current) {
        stream.current = null;
        setLive(false);
        notify(cameraErrorMessage(error));
      }
    }
  }

  async function preview(src: string) {
    const token = ++generation.current;
    request.current?.abort();
    fillRequest.current?.abort();
    setFillBusy(false);
    filling.current = false;
    const ctrl = new AbortController();
    request.current = ctrl;
    stopCamera();
    try {
      const ready = await compressImage(src, 960, 0.72);
      if (token !== generation.current) return;
      setImage(ready);
      blob.current = dataUrlToBlob(ready);
      setThinking(true);
      if (!ai.configured) {
        setStatus("服务器未配置 AI，改用本地简易识别");
        const result = await runLocalFallback(ready);
        if (token !== generation.current) return;
        setField("description", result);
        setStatus(`本地简易识别：${result}。建议配置大模型。`);
      } else {
        setStatus(`正在调用 ${ai.model} 识别物品…`);
        const image = await compressImage(ready);
        const result = await api<{ text: string }>("/api/ai/vision", {
          method: "POST",
          json: { image },
          signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(45000)]),
        });
        if (token !== generation.current) return;
        setField("description", result.text);
        setStatus(`服务器 AI 已提取：${result.text}`);
        document.getElementById("description")?.focus();
      }
    } catch (err) {
      if (token !== generation.current || ctrl.signal.aborted) return;
      setStatus(`识别失败：${message(err)}`);
      notify("大模型识别失败");
    } finally {
      if (token === generation.current) setThinking(false);
    }
  }
  function pick(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    const token = ++generation.current;
    reader.onload = () => {
      if (token === generation.current && mounted.current)
        void preview(String(reader.result));
    };
    reader.onerror = () => notify("读取图片失败，请换一张再试");
    reader.readAsDataURL(file);
  }
  function capture() {
    const video = videoRef.current;
    if (!stream.current || !video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas
      .getContext("2d")!
      .drawImage(video, 0, 0, canvas.width, canvas.height);
    void preview(canvas.toDataURL("image/jpeg", 0.85));
    notify("已拍照，正在识别…");
  }
  async function extract() {
    const spoken = fillText.trim();
    if (!spoken) {
      notify("先把一段话贴进来");
      document.getElementById("fillText")?.focus();
      return;
    }
    if (filling.current) return;
    filling.current = true;
    setFillBusy(true);
    const ctrl = new AbortController();
    fillRequest.current = ctrl;
    const token = generation.current;
    try {
      const local = localExtractFillFields(spoken);
      let fields = local,
        usedAi = false;
      if (ai.configured) {
        try {
          const result = await api<FillFields>("/api/ai/extract", {
            method: "POST",
            json: { transcript: spoken },
            signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(45000)]),
          });
          fields = Object.fromEntries(
            Object.keys(local).map((k) => [
              k,
              result[k as keyof FillFields] || local[k as keyof FillFields],
            ]),
          ) as unknown as FillFields;
          usedAi = true;
        } catch (err) {
          if (ctrl.signal.aborted) return;
          notify("自动填写没成功，你也可以自己写地点：" + message(err).slice(0, 40));
        }
      }
      if (ctrl.signal.aborted || token !== generation.current) return;
      if (fields.place) setForm((f) => ({ ...f, place: fields.place }));
      notify(
        fields.place
          ? usedAi
            ? "已填上捡到地点。领取地点仍是逸夫楼316。"
            : "已填上捡到地点。领取地点不用改。"
          : "这段话里没找到地点。可以自己写，也可以留空。",
      );
    } finally {
      if (fillRequest.current === ctrl) {
        filling.current = false;
        setFillBusy(false);
      }
    }
  }
  async function submit() {
    if (submitting.current) return;
    if (!image && !editId) {
      notify("请先拍照或从相册选择图片");
      return;
    }
    if (!form.description.trim()) {
      notify("请先写物品描述");
      document.getElementById("description")?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setReviewIssues([]);
    try {
      const data = new FormData();
      data.append("ownerId", getPublisherId());
      const payload = {
        ...form,
        office: FIXED_OFFICE,
        contact: "",
      };
      for (const [key, value] of Object.entries(payload))
        data.append(key, value.trim());
      if (blob.current) data.append("image", blob.current, "item.jpg");
      await api(
        editId ? `/api/items/${encodeURIComponent(editId)}` : "/api/items",
        { method: editId ? "PATCH" : "POST", body: data },
      );
      notify(editId ? "修改已经公开" : "已经公开，别人可以来看了");
      reset();
      await onPublished();
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) {
        setReviewIssues(err.issues);
        const first = err.issues[0];
        notify(message(err));
        if (
          first?.field &&
          first.field !== "general" &&
          first.field !== "image" &&
          first.field !== "publication"
        )
          document.getElementById(first.field)?.focus();
        setStatus(
          err.reviewStatus === "unavailable" || err.status === 503
            ? "审核暂时不可用，照片和文字都还在，请稍后再试"
            : "有几处需要改。看红色提示，照片和文字都还在。",
        );
      } else {
        notify(message(err));
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  function edit(item: Item) {
    cancel();
    setEditId(item.id);
    setReviewIssues([]);
    setForm({
      description: item.description,
      office: FIXED_OFFICE,
      place: item.place,
      note: "",
      contact: "",
      contactType: CONTACT_TYPES.includes(item.contactType)
        ? item.contactType
        : "",
      contactValue: item.contactValue,
    });
    setImage(appUrl(item.image));
    blob.current = null;
    setStatus("正在修改。可以换照片，也可以改文字，改完再保存。");
    notify("已打开这条，改完再保存");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const defaultStatus = ai.configured
    ? `拍照后会自动认出物品（${ai.model}），你也可以自己改。`
    : "还没配好自动识别。自己写描述就行。";
  return {
    form,
    setField,
    editId,
    image,
    live,
    busy,
    fillBusy,
    fillText,
    setFillText,
    status: status || defaultStatus,
    thinking,
    reviewIssues,
    videoRef,
    fileRef,
    startCamera,
    stopCamera,
    cancel,
    pick,
    capture,
    extract,
    submit,
    edit,
    reset,
  };
}
export type FoundModel = ReturnType<typeof useFound>;
