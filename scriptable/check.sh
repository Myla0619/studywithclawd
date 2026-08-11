#!/bin/bash
# 改完跑这个。踩过的坑都在这儿盯着：
#
#  1. 顶层 await —— Scriptable 允许，Node 的 CommonJS 不允许，所以按模块语义查。
#  2. 页面里的 JS —— 它被包在一个模板字符串里，对外层文件来说只是一段普通字符串，
#     `node --check MylaView.js` 根本看不见它。里面写错了照样「通过」，
#     装到手机上就是白屏。所以要单独抠出来查一遍。
#  3. 模板字符串里的转义 —— HTML 属性里的 \\' 少写一个反斜杠就会把引号提前闭合。
#  4. 正则字面量里的 U+2028/2029 —— 它俩本身就是换行符，写进去当场断行。

set -u
cd "$(dirname "$0")"
fail=0

echo "── 外层文件语法（按模块语义，允许顶层 await）"
for f in *.js; do
  cp "$f" "/tmp/_chk.mjs"
  if node --check "/tmp/_chk.mjs" 2>/dev/null; then
    echo "  ✓ $f"
  else
    echo "  ✗ $f"
    node --check "/tmp/_chk.mjs" 2>&1 | head -4 | sed 's/^/      /'
    fail=1
  fi
  rm -f "/tmp/_chk.mjs"
done

echo
echo "── 页面里的 JS（模板字符串内部，外层查不到）"
node -e '
const H = require("./MylaView.js").HTML
const i = H.indexOf("<script>"), j = H.lastIndexOf("</script>")
if (i < 0) { console.error("找不到 <script>"); process.exit(1) }
require("fs").writeFileSync("/tmp/_page.js", H.slice(i + 8, j))
console.log("  抠出 " + (j - i) + " 字符")
' || fail=1
if node --check /tmp/_page.js 2>/dev/null; then
  echo "  ✓ 页面 JS"
else
  echo "  ✗ 页面 JS"
  node --check /tmp/_page.js 2>&1 | head -6 | sed 's/^/      /'
  fail=1
fi
rm -f /tmp/_page.js

echo
echo "── 正则字面量里有没有混进 U+2028 / U+2029"
if grep -lP '/[^/\n]*[\x{2028}\x{2029}][^/\n]*/' *.js 2>/dev/null | grep . ; then
  echo "  ✗ 上面这些文件的正则里有行分隔符"
  fail=1
else
  echo "  ✓ 没有"
fi

echo "── 模板字符串会吞掉的单反斜杠转义（\\d 写成 \\\\d 才对）"
if grep -n '\\[dswDSWb]' MylaView.js | grep -v '\\\\[dswDSWb]' ; then
  echo "  ✗ 上面这些是单反斜杠，模板字符串会把它变成普通字母，正则就废了"
  fail=1
else
  echo "  ✓ 没有"
fi

echo "── 页面里定义了却没人调的函数"
# 这条是补的：倒数日、自动切换、检查更新三个入口曾经写好了函数但没接进界面，
# 语法全对、也测不出来（我测试时是直接调函数，没从界面点进去）。
node -e '
const H = require("./MylaView.js").HTML
const i = H.indexOf("<script>"), j = H.lastIndexOf("</script>")
const js = H.slice(i + 8, j)
const defs = [...js.matchAll(/function ([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1])
const orphans = defs.filter(n => {
  // 在整个页面里数，不能只数 <script> 里面——导航栏和弹层的 onclick 写在静态 HTML 上
  const uses = H.split(new RegExp("\\b" + n + "\\b")).length - 1
  return uses <= 1                       // 只出现在自己的定义里
})
if (orphans.length) { console.log("  ✗ 没人调：" + orphans.join("、")); process.exit(1) }
console.log("  ✓ 都有人调")
' || fail=1

echo "── 端到端：把整个 Myla.js 真跑一遍"
# 之前只抽单个函数出来测，所以「const SID 声明在入口之后」这种错一次都没拦住——
# 语法全对、函数单测也全对，但整个文件一跑就 TDZ 报错。
if node smoke.mjs > /tmp/_smoke.log 2>&1; then
  sed -n 's/^/  /p' /tmp/_smoke.log | grep -E "✓|→" | head -12
else
  echo "  ✗ 跑不起来"
  tail -12 /tmp/_smoke.log | sed 's/^/      /'
  fail=1
fi
rm -f /tmp/_smoke.log

echo
[ $fail -eq 0 ] && echo "全过 ✅" || echo "有问题 ❌"
exit $fail
