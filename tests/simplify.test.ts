import { describe, expect, it } from "vitest";
import { simplifyDescription } from "../src/client/simplify";

describe("simplifyDescription", () => {
  it("drops greetings, filler and thanks", () => {
    expect(
      simplifyDescription(
        "你好，请问我昨天在图书馆丢了一个蓝色水杯，然后那个杯盖是白色的，谢谢大家",
      ),
    ).toBe("我昨天在图书馆丢了一个蓝色水杯，杯盖是白色的。");
  });
  it("keeps a short description that is already clear", () => {
    expect(simplifyDescription("灰色保温杯")).toBe("灰色保温杯");
  });
});
