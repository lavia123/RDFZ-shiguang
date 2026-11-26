interface Props {
  open: boolean;
  onClose: () => void;
}
export function LoginRequired({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div
      className="login-modal"
      id="loginModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loginTitle"
    >
      <div className="login-card">
        <div className="brand" id="loginTitle">
          请先登录
        </div>
        <p className="lead">
          先看也可以。要发布或领取，需要用学校账号。这里不注册，也不用填手机号。
        </p>
        <p className="lead">学校登录还没接上，所以现在还不能发布或领取。</p>
        <button
          type="button"
          className="btn btn-primary"
          id="btnCloseLogin"
          style={{ width: "100%" }}
          onClick={onClose}
        >
          返回浏览
        </button>
      </div>
    </div>
  );
}
