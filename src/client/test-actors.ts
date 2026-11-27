/** 本地试用账号提示（真实校验在服务端，默认密码可在用户设置中修改）。 */
export const LOCAL_TRIAL_HINTS = [
  { name: "测试同学", className: "高一1班", defaultPassword: "456" },
  { name: "同班同学", className: "高一1班", defaultPassword: "123" },
] as const;

/** 管理员试用提示：登录表单第二栏为「所属处室」。 */
export const LOCAL_ADMIN_HINT = {
  name: "测试老师",
  className: "学生事务中心",
  defaultPassword: "admin",
} as const;
