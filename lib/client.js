window.__ModuleLoader__.load({
	id: "dsh-ssh-terminal",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.tsx
		const API = "/ssh-terminal/api";
		function fmt(ts) {
			const d = new Date(ts);
			const p = (n) => String(n).padStart(2, "0");
			return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
		}
		const SSH_CSS = `
.dshssh-body{display:flex;flex-direction:column;gap:8px;height:100%;box-sizing:border-box;padding:10px;color:var(--dsw-alias-label-primary,inherit);}
.dshssh-head{display:flex;align-items:center;gap:8px;}
.dshssh-title{font-weight:700;flex:1;}
.dshssh-status{font-weight:600;}
.dshssh-status.ok{color:var(--dsw-alias-state-success-primary,#22c55e);}
.dshssh-status.off{color:var(--dsw-alias-label-tertiary,#94a3b8);}
.dshssh-form{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.dshssh-input{padding:4px 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(148,163,184,.4));background:var(--dsw-alias-bg-layer-3,rgba(2,6,23,.5));color:var(--dsw-alias-label-primary,inherit);font-size:12px;min-width:70px;}
.dshssh-input::placeholder{color:var(--dsw-alias-label-tertiary,#94a3b8);}
.dshssh-btn{padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(148,163,184,.4));background:var(--dsw-alias-interactive-bg-hover,rgba(148,163,184,.15));color:var(--dsw-alias-label-primary,inherit);cursor:pointer;font-size:12px;}
.dshssh-btn:hover{background:var(--dsw-alias-interactive-bg-active,rgba(148,163,184,.28));}
.dshssh-btn:disabled{opacity:.5;cursor:default;}
.dshssh-log{flex:1;min-height:120px;overflow:auto;background:var(--dsw-alias-bg-layer-1,rgba(2,6,23,.55));border:1px solid var(--dsw-alias-border-l2,rgba(148,163,184,.25));border-radius:8px;padding:8px;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}
.dshssh-step{margin:0 0 6px;}
.dshssh-cmd{color:var(--dsw-alias-accent,#93c5fd);}
.dshssh-cmd::before{content:"❯ ";color:var(--dsw-alias-accent,#60a5fa);}
.dshssh-out{color:var(--dsw-alias-label-secondary,#d1d5db);}
.dshssh-connect{color:var(--dsw-alias-state-success-primary,#86efac);}
.dshssh-disconnect{color:var(--dsw-alias-state-error-primary,#fca5a5);}
.dshssh-system{color:var(--dsw-alias-label-tertiary,#94a3b8);font-style:italic;}
.dshssh-err{color:var(--dsw-alias-state-error-primary,#fca5a5);}
`;
		async function callApi(action, extra) {
			return await (await fetch(API, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					action,
					...extra || {}
				})
			})).json();
		}
		function injectCss() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css=\"dsh-ssh-terminal\"]")) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-ssh-terminal";
			tag.dataset.pluginCss = "dsh-ssh-terminal";
			tag.textContent = SSH_CSS;
			document.head.appendChild(tag);
		}
		function SshBody(props) {
			const ctx = props.ctx;
			const visible = props.visible === void 0 ? true : props.visible;
			const [busy, setBusy] = (0, react.useState)(false);
			const [err, setErr] = (0, react.useState)("");
			const [hostV, setHostV] = (0, react.useState)("");
			const [userV, setUserV] = (0, react.useState)("");
			const [portV, setPortV] = (0, react.useState)("22");
			const [passV, setPassV] = (0, react.useState)("");
			const [cmdV, setCmdV] = (0, react.useState)("");
			const [connected, setConnected] = (0, react.useState)(false);
			const [target, setTarget] = (0, react.useState)("");
			const [steps, setSteps] = (0, react.useState)([]);
			const [logEl, setLogEl] = (0, react.useState)(null);
			async function refresh() {
				try {
					const t = await callApi("status");
					setConnected(!!(t && t.connected));
					setTarget(t && t.target || "");
					setSteps(t && t.steps || []);
				} catch (e) {}
			}
			(0, react.useEffect)(() => {
				injectCss();
				if (visible === false) return;
				refresh();
				const stop = ctx.interval(() => refresh(), 600);
				return () => {
					try {
						stop();
					} catch (e) {}
				};
			}, [visible]);
			(0, react.useEffect)(() => {
				const el = logEl;
				if (!el) return;
				if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) el.scrollTop = el.scrollHeight;
			}, [steps, logEl]);
			async function connect() {
				setBusy(true);
				setErr("");
				try {
					await callApi("connect", {
						host: hostV,
						user: userV,
						port: Number(portV) || 22,
						password: passV || void 0
					});
					await refresh();
				} catch (e) {
					setErr(String(e && e.message || e));
				} finally {
					setBusy(false);
				}
			}
			async function run() {
				setBusy(true);
				setErr("");
				try {
					const r = await callApi("exec", {
						command: cmdV,
						waitMs: 15e3
					});
					if (r && r.error) setErr(String(r.error));
					await refresh();
				} catch (e) {
					setErr(String(e && e.message || e));
				} finally {
					setBusy(false);
				}
			}
			async function disconnect() {
				setBusy(true);
				setErr("");
				try {
					await callApi("disconnect");
					await refresh();
				} catch (e) {
					setErr(String(e && e.message || e));
				} finally {
					setBusy(false);
				}
			}
			async function clearHistory() {
				try {
					if (window.confirm("确定清空本次 SSH 操作记录吗？")) {
						await callApi("clear");
						await refresh();
					}
				} catch (e) {
					setErr(String(e && e.message || e));
				}
			}
			const onKey = (e) => {
				if (e.key === "Enter" && connected && !busy) run();
			};
			const status = connected ? "● " + target : "○ 未连接";
			return (0, react.createElement)("div", { className: "dshssh-body" }, (0, react.createElement)("div", { className: "dshssh-head" }, (0, react.createElement)("span", { className: "dshssh-title" }, "SSH 远程终端"), (0, react.createElement)("span", { className: "dshssh-status " + (connected ? "ok" : "off") }, status), (0, react.createElement)("button", {
				className: "dshssh-btn dshssh-clear",
				onClick: clearHistory
			}, "清空记录")), (0, react.createElement)("div", { className: "dshssh-form" }, (0, react.createElement)("input", {
				className: "dshssh-input",
				placeholder: "主机",
				value: hostV,
				onChange: (e) => setHostV(e.target.value)
			}), (0, react.createElement)("input", {
				className: "dshssh-input",
				placeholder: "用户",
				value: userV,
				onChange: (e) => setUserV(e.target.value)
			}), (0, react.createElement)("input", {
				className: "dshssh-input",
				style: { width: 54 },
				placeholder: "端口",
				value: portV,
				onChange: (e) => setPortV(e.target.value)
			}), (0, react.createElement)("input", {
				className: "dshssh-input",
				style: { width: 96 },
				type: "password",
				placeholder: "密码(可选)",
				value: passV,
				onChange: (e) => setPassV(e.target.value)
			}), (0, react.createElement)("button", {
				className: "dshssh-btn",
				disabled: busy,
				onClick: connect
			}, "连接")), (0, react.createElement)("div", { className: "dshssh-form" }, (0, react.createElement)("input", {
				className: "dshssh-input dshssh-cmdline",
				style: { flex: 1 },
				placeholder: "输入命令后回车或点执行",
				value: cmdV,
				onChange: (e) => setCmdV(e.target.value),
				onKeyDown: onKey
			}), (0, react.createElement)("button", {
				className: "dshssh-btn",
				disabled: busy || !connected,
				onClick: run
			}, "执行"), (0, react.createElement)("button", {
				className: "dshssh-btn",
				disabled: busy || !connected,
				onClick: disconnect
			}, "断开")), (0, react.createElement)("div", {
				className: "dshssh-log",
				ref: (el) => setLogEl(el)
			}, steps.length ? steps.map((s, i) => (0, react.createElement)("div", {
				key: i,
				className: "dshssh-step dshssh-" + s.kind
			}, fmt(s.ts) + "  " + s.text)) : (0, react.createElement)("div", { className: "dshssh-step dshssh-system" }, "还没有操作。")), err ? (0, react.createElement)("div", { className: "dshssh-err" }, String(err)) : null);
		}
		const inject = ["timer", "betterSidebar"];
		function apply(ctx) {
			const bs = ctx.get("betterSidebar");
			if (!bs) return;
			ctx.effect(() => bs.registerTab({
				id: "ssh-remote:terminal",
				title: "SSH 终端",
				order: 60,
				single: true,
				component: (p) => (0, react.createElement)(SshBody, {
					ctx,
					visible: p.visible
				})
			}));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map