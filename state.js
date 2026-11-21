// 木偶记忆：会话消息读写的几个小工具。
//
// 2026-11-21 丹阳定：**三线状态整体删除**（工作/陪伴/学习）。原来的 weights 引擎、
// 词表、衰减、定性描述、工具方向提示全部下线——它跟状态卡说的是同一件事，没有正文价值。
// 这里只留下别的模块真在用的东西：框架噪声剥离、取最后一条用户发言、取助手输出门牌。

import crypto from "node:crypto";

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, Number(v)));
}

export function round(v, digits = 4) {
  const f = 10 ** digits;
  return Math.round(Number(v) * f) / f;
}

/**
 * 把框架自己塞进来的噪声从「用户发言」里剥掉。
 * <system-reminder> / <puppet_xxx> / [Plugin context …] / [梗百科…] 都不是他说的话。
 */
export function stripFrameworkNoise(text) {
  let t = String(text || "");
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ");
  t = t.replace(/<puppet_[a-z_]+>[\s\S]*?<\/puppet_[a-z_]+>/gi, " ");
  t = t.replace(/\[Plugin context from[^\]]*\][\s\S]*?(?=\n\n|$)/gi, " ");
  t = t.replace(/\[梗百科[^\]]*\][\s\S]*?(?=\n\n|$)/gi, " ");
  t = t.replace(/^\s*\[[^\]]{0,40}\][\s\S]*$/m, (m) => (/^\s*\[\S/.test(m) ? m : m));
  // 2026-11-21：注入块改成中文抬头，没有英文标记可剥——整条以「【记忆·…】/【复位】」开头的就不是他说的话
  if (/^\s*(【记忆·[^】]*】|【复位】)/.test(t.trim())) return "";
  return t.replace(/\s+/g, " ").trim();
}

/**
 * 从 pre-step 的消息列表里取「最后一条真实用户消息」。
 * 没有用户消息、或全是插件自己注入的，返回 { text: "", skipped }。
 */
export function lastUserText(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (!m || m.role !== "user") continue;
    // 我们自己注入的消息不算用户发言
    const src = m.source || {};
    if (src.kind && String(src.kind).startsWith("plugin:")) continue;
    const text = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((b) => (b && b.type === "text" ? b.text || "" : "")).join("\n")
        : "";
    const clean = stripFrameworkNoise(text);
    if (!clean) continue; // 剥完只剩框架噪声，就不算用户发言
    const key = String(m.id || "") || crypto.createHash("sha1").update(`${text}`).digest("hex").slice(0, 12);
    return { text: clean, key };
  }
  return { text: "", skipped: "no-user-message" };
}

/**
 * v0.44.1：取最后一条「有正文的助手输出」当注入门牌。
 * PTC 下一次用户回合里会跑好几个程序，但助手正文只出一次——用它当门，
 * 同一次输出内的后续步骤就不再重复注入。
 */
export function lastAssistantTextId(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (!m || m.role !== "assistant") continue;
    const text = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((b) => (b && b.type === "text" ? b.text || "" : "")).join("")
        : "";
    if (!String(text || "").trim()) continue;
    return String(m.id || "") || crypto.createHash("sha1").update(String(text)).digest("hex").slice(0, 12);
  }
  return "";
}
