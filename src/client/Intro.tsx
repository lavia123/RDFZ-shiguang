import { appUrl } from "./paths";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api";
import "./styles/intro.css";
const GITHUB_URL = "https://github.com/lavia123/RDFZ-shiguang";
export default function Intro() {
  const [status, setStatus] = useState({ text: "", error: false });
  const working = useRef(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (working.current) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const body = {
      name: String(data.get("name") || "").trim(),
      contact: String(data.get("contact") || "").trim(),
      message: String(data.get("message") || "").trim(),
    };
    if (!body.message) {
      setStatus({ text: "请填写反馈内容", error: true });
      return;
    }
    working.current = true;
    setStatus({ text: "提交中…", error: false });
    try {
      await api("/api/feedback", { method: "POST", json: body });
      form.reset();
      setStatus({ text: "已收到，谢谢你的反馈！", error: false });
    } catch {
      setStatus({ text: "提交失败，请检查拾光服务连接后重试。", error: true });
    } finally {
      working.current = false;
    }
  }
  return (
    <div className="wrap">
      <header className="hero">
        <div className="hero-bg" aria-hidden="true"></div>
        <div className="hero-content">
          <p className="brand">拾光</p>
          <p className="topic">课题：失物招领网站</p>
          <p className="hero-lead">
            面向校园的失物招领共享站点——同学打开同一网址即可发布、浏览、对接，让遗失物品更快回到主人手中。
          </p>
          <div className="cta-row">
            <a className="btn btn-primary" href="#feedback">
              提交反馈
            </a>
            <a
              className="btn btn-ghost"
              id="githubCta"
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub 仓库
            </a>
          </div>
          <p className="scroll-hint">下滑了解目标用户与设想</p>
        </div>
      </header>

      <section id="meta" aria-labelledby="meta-title">
        <p className="sec-label">Project</p>
        <h2 id="meta-title">课题与组员</h2>
        <div className="panel">
          <ul className="meta-list">
            <li>
              <span className="meta-k">课题名称</span>
              <span className="meta-v">失物招领网站</span>
            </li>
            <li>
              <span className="meta-k">产品名</span>
              <span className="meta-v">拾光 · 校园失物招领</span>
            </li>
            <li>
              <span className="meta-k">组员</span>
              <span className="meta-v">唐誉庭、任韵洁</span>
            </li>
          </ul>
        </div>
      </section>

      <section id="users" aria-labelledby="users-title">
        <p className="sec-label">Audience</p>
        <h2 id="users-title">目标用户</h2>
        <div className="panel">
          <p>
            以<strong>在校师生与校园工作人员</strong>
            为主：捡到物品想尽快找到失主的人，以及丢失物品、需要按地点/时间检索招领信息的人。
          </p>
          <p>
            管理员和公共终端由学校平台授权。管理员核对高价值物品后交付，公共终端只负责拍照发布。
          </p>
          <div className="chip-row">
            <span className="chip">登录后使用</span>
            <span className="chip">发布和领取走平台身份</span>
            <span className="chip">同校 / 同局域网可共享</span>
          </div>
        </div>
      </section>

      <section id="vision" aria-labelledby="vision-title">
        <p className="sec-label">Concept</p>
        <h2 id="vision-title">初步设想</h2>
        <div className="idea-grid">
          <div className="idea">
            <strong>低门槛发布</strong>
            <span>
              学生或管理员登录后才能浏览招领。发布和领取使用学校平台的姓名与班级，不在这里注册，也不用填写手机号。
            </span>
          </div>
          <div className="idea">
            <strong>隐私按需解锁</strong>
            <span>
              保管位置对浏览者可见。个人联系方式和领取人信息只给本人和管理员看。
            </span>
          </div>
          <div className="idea">
            <strong>找回闭环</strong>
            <span>
              普通物品由本人在交付后登记。高价值物品要先交到老师处，再由管理员确认交付。
            </span>
          </div>
          <div className="idea">
            <strong>数据共享可用</strong>
            <span>
              同学打开同一服务地址即可看到彼此发布的内容；支持本机一键启动，也可部署到云端公网。
            </span>
          </div>
        </div>
      </section>

      <section id="github" aria-labelledby="github-title">
        <p className="sec-label">Source</p>
        <h2 id="github-title">GitHub 仓库</h2>
        <div className="panel repo-box">
          <a
            className="repo-link"
            id="githubLink"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {GITHUB_URL}
          </a>
          <p className="repo-note">
            源码与安装说明见仓库
            README。项目的安装、运行和配置方式请参阅仓库文档，也欢迎在 GitHub
            提交遇到的问题和改进建议。
          </p>
          <div className="cta-row">
            <a
              className="btn btn-ghost"
              id="githubBtn"
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开仓库
            </a>
            <a className="btn btn-ghost" href={appUrl("/")}>
              进入拾光站点
            </a>
          </div>
        </div>
      </section>

      <section id="feedback" aria-labelledby="feedback-title">
        <p className="sec-label">Feedback</p>
        <h2 id="feedback-title">提交反馈</h2>
        <div className="panel">
          <p style={{ marginBottom: "16px" }}>
            对课题、功能或体验有建议？欢迎留下反馈，我们会用于后续迭代。
          </p>
          <form className="feedback" id="feedbackForm" onSubmit={submit}>
            <label>
              称呼（选填）
              <input
                type="text"
                name="name"
                maxLength={40}
                placeholder="例如：同学 / 老师"
                autoComplete="nickname"
              />
            </label>
            <label>
              联系方式（选填）
              <input
                type="text"
                name="contact"
                maxLength={80}
                placeholder="邮箱 / 微信号，方便回访"
                autoComplete="email"
              />
            </label>
            <label>
              反馈内容
              <textarea
                name="message"
                maxLength={1000}
                required
                placeholder="想改进的地方、遇到的问题，或对课题的想法…"
              ></textarea>
            </label>
            <p className="form-hint">
              提交后数据保存在本站服务器（需先启动拾光服务）。
            </p>
            <button className="btn btn-primary" type="submit">
              发送反馈
            </button>
            <p
              className={"form-status" + (status.error ? " error" : "")}
              id="formStatus"
              role="status"
              aria-live="polite"
            >
              {status.text}
            </p>
          </form>
        </div>
      </section>

      <footer>
        <p className="brand-mini">拾光</p>
        <p>课题「失物招领网站」· 组员 唐誉庭、任韵洁</p>
      </footer>
    </div>
  );
}
