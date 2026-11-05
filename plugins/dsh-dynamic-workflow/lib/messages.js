/**
 * Host-side copy for `/workflow`, in the language DSH is set to.
 * @module dsh-dynamic-workflow/messages
 */
const MESSAGES = {
  description: ['把任务编排成动态 workflow 并在输入框上方实时显示，或运行已保存的：/workflow <任务 | 名称> [JSON参数]', 'Orchestrate a task as a live dynamic workflow, or run a saved one: /workflow <task | name> [json-args]'],
  hint: ['<任务描述或已保存的名称> [JSON参数]', '<task or saved name> [json-args]'],
  noSaved: ['还没有保存的 workflow。用 /workflow <任务> 让模型编排并运行一个。', 'No saved workflows. Use /workflow <task> to have the model orchestrate one.'],
  savedHeader: ['已保存的 workflow（/workflow <名称> 运行）：', 'Saved workflows (run with /workflow <name>):'],
  launching: ['正在运行 workflow「{name}」（{scope}），进度显示在输入框上方', 'Launching workflow "{name}" ({scope}); progress shows above the input'],
  orchestrating: ['正在为任务编排 workflow：{task}', 'Orchestrating a workflow for: {task}'],
  scope_project: ['项目', 'project'],
  scope_global: ['全局', 'global'],
};

export function message(lang, key, vars) {
  const pair = MESSAGES[key];
  let text = pair ? pair[lang === 'zh' ? 0 : 1] : key;
  if (vars) for (const name of Object.keys(vars)) text = text.split(`{${name}}`).join(String(vars[name]));
  return text;
}

export { MESSAGES };
