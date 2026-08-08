/**
 * 代码片段生成器插件
 * 常用代码片段一键生成和复制
 */
(function(){
  const CodeSnippet={
    id:'code-snippet', name:'代码片段生成器',
    snippets:{
      '🌐 JS Fetch 请求': {
        '基础 GET':`fetch('https://api.example.com/data')\n  .then(res => res.json())\n  .then(data => console.log(data))\n  .catch(err => console.error('Error:', err));`,
        'POST JSON':`fetch('https://api.example.com/users', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'John', age: 30 })\n})\n.then(res => res.json())\n.then(data => console.log(data));`,
        'async/await':`async function fetchData(url) {\n  try {\n    const res = await fetch(url);\n    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);\n    return await res.json();\n  } catch (err) {\n    console.error('Fetch failed:', err);\n    throw err;\n  }\n}`,
        '带 AbortController':`const controller = new AbortController();\nconst timeoutId = setTimeout(() => controller.abort(), 5000);\n\ntry {\n  const res = await fetch(url, { signal: controller.signal });\n  clearTimeout(timeoutId);\n  const data = await res.json();\n} catch (err) {\n  if (err.name === 'AbortError') console.log('请求超时');\n  else console.error(err);\n}`,
      },
      '🔄 JS 循环': {
        'for 循环':`for (let i = 0; i < array.length; i++) {\n  const item = array[i];\n  // 处理 item\n}`,
        'forEach':`array.forEach((item, index) => {\n  // 处理 item\n});`,
        'for...of':`for (const item of array) {\n  // 处理 item\n}`,
        'for...in':`for (const key in object) {\n  if (object.hasOwnProperty(key)) {\n    const value = object[key];\n  }\n}`,
        'while':`let i = 0;\nwhile (i < array.length) {\n  // 处理 array[i]\n  i++;\n}`,
        'reduce':`const result = array.reduce((acc, item) => {\n  // acc: 累计值\n  // 返回新值\n  return acc;\n}, initialValue);`,
        'map + filter':`const result = array\n  .filter(item => item.active)\n  .map(item => ({ ...item, processed: true }));`,
      },
      '🛡️ 错误处理': {
        'try-catch':`try {\n  // 可能出错的代码\n  const result = riskyOperation();\n} catch (error) {\n  console.error('错误:', error.message);\n} finally {\n  // 始终执行\n  cleanup();\n}`,
        '错误类型判断':`try {\n  riskyOperation();\n} catch (error) {\n  if (error instanceof TypeError) {\n    console.error('类型错误:', error.message);\n  } else if (error instanceof RangeError) {\n    console.error('范围错误:', error.message);\n  } else {\n    console.error('未知错误:', error);\n  }\n}`,
        '自定义错误':`class AppError extends Error {\n  constructor(message, code, statusCode = 500) {\n    super(message);\n    this.name = 'AppError';\n    this.code = code;\n    this.statusCode = statusCode;\n  }\n}\n\nthrow new AppError('用户不存在', 'USER_NOT_FOUND', 404);`,
        'Promise 错误处理':`promise\n  .then(data => processData(data))\n  .catch(err => {\n    if (err.code === 'NETWORK_ERROR') {\n      return retry();\n    }\n    throw err;\n  })\n  .finally(() => {\n    loading = false;\n  });`,
      },
      '🗃️ SQL 查询': {
        '基础查询':`SELECT * FROM users\nWHERE status = 'active'\nORDER BY created_at DESC\nLIMIT 20 OFFSET 0;`,
        'JOIN 查询':`SELECT u.name, o.id, o.total\nFROM users u\nINNER JOIN orders o ON u.id = o.user_id\nWHERE o.created_at >= '2024-01-01'\nORDER BY o.total DESC;`,
        '聚合查询':`SELECT \n  DATE(created_at) AS date,\n  COUNT(*) AS count,\n  AVG(amount) AS avg_amount,\n  SUM(amount) AS total_amount\nFROM orders\nWHERE created_at >= '2024-01-01'\nGROUP BY DATE(created_at)\nHAVING COUNT(*) > 10\nORDER BY date;`,
        'INSERT':`INSERT INTO users (name, email, role)\nVALUES ('John', 'john@example.com', 'admin');`,
        'UPDATE':`UPDATE users\nSET status = 'inactive', updated_at = NOW()\nWHERE last_login < '2023-01-01'\nAND status = 'active';`,
        '事务':`BEGIN;\n\nUPDATE accounts SET balance = balance - 100 WHERE id = 1;\nUPDATE accounts SET balance = balance + 100 WHERE id = 2;\n\nCOMMIT;`,
      },
      '⚛️ React Hooks': {
        'useState':`const [state, setState] = useState(initialValue);\n\n// 更新\nsetState(newValue);\nsetState(prev => prev + 1);`,
        'useEffect':`useEffect(() => {\n  // 副作用\n  const subscription = api.subscribe(data);\n  \n  return () => {\n    // 清理\n    subscription.unsubscribe();\n  };\n}, [dependency]);`,
        'useCallback + useMemo':`const memoizedFn = useCallback((arg) => {\n  return doSomething(arg);\n}, [dependency]);\n\nconst memoizedValue = useMemo(() => {\n  return computeExpensiveValue(a, b);\n}, [a, b]);`,
        '自定义 Hook':`function useDebounce(value, delay = 300) {\n  const [debounced, setDebounced] = useState(value);\n\n  useEffect(() => {\n    const timer = setTimeout(() => setDebounced(value), delay);\n    return () => clearTimeout(timer);\n  }, [value, delay]);\n\n  return debounced;\n}`,
      },
      '🐍 Python 常用': {
        '列表推导式':`result = [x * 2 for x in range(10) if x % 2 == 0]`,
        '字典推导式':`result = {k: v for k, v in items if v is not None}`,
        '上下文管理器':`with open('file.txt', 'r') as f:\n    content = f.read()`,
        '异常处理':`try:\n    result = risky_operation()\nexcept ValueError as e:\n    print(f"Value error: {e}")\nexcept Exception as e:\n    print(f"Unexpected: {e}")\nfinally:\n    cleanup()`,
        '装饰器':`import functools\n\ndef retry(max_attempts=3):\n    def decorator(func):\n        @functools.wraps(func)\n        def wrapper(*args, **kwargs):\n            for attempt in range(max_attempts):\n                try:\n                    return func(*args, **kwargs)\n                except Exception as e:\n                    if attempt == max_attempts - 1:\n                        raise\n        return wrapper\n    return decorator`,
      },
    },
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('snippet-panel',{title:'代码片段生成器',icon:'code',render:c=>this.renderPanel(c)});
      }
    },
    escapeHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');},
    renderPanel(container){
      const categories=Object.keys(this.snippets);
      const catTabs=categories.map((c,i)=>`<button class="sc-tab ${i===0?'active':''}" data-cat="${c}">${c}</button>`).join('');
      container.innerHTML=`
        <div class="plugin-code-snippet">
          <div class="sc-tabs">${catTabs}</div>
          <div class="sc-list" id="sc-list"></div>
          <div class="sc-code-wrap" id="sc-code-wrap" style="display:none">
            <div class="sc-code-header"><span id="sc-code-title"></span><button class="sc-copy" id="sc-copy">📋 复制代码</button></div>
            <pre class="sc-code" id="sc-code"></pre>
          </div>
          <style>
            .plugin-code-snippet{padding:16px;}
            .sc-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;}
            .sc-tab{padding:5px 12px;background:#1a1d23;border:1px solid #3a3f47;color:#888;border-radius:6px;cursor:pointer;font-size:0.85em;}
            .sc-tab.active{background:#4caf5022;color:#4caf50;border-color:#4caf50;}
            .sc-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;margin-bottom:14px;}
            .sc-item{padding:8px 12px;background:#1a1d23;border:1px solid #3a3f47;border-radius:6px;cursor:pointer;font-size:0.85em;color:#aaa;transition:all 0.15s;}
            .sc-item:hover{border-color:#4caf50;color:#4caf50;background:#4caf5011;}
            .sc-item.active{border-color:#4caf50;color:#4caf50;background:#4caf5022;}
            .sc-code-wrap{border:1px solid #3a3f47;border-radius:8px;overflow:hidden;}
            .sc-code-header{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#2a2e35;color:#888;font-size:0.85em;}
            .sc-copy{padding:2px 8px;background:#3a3f47;border:none;color:#aaa;border-radius:3px;cursor:pointer;}
            .sc-copy:hover{background:#4caf5033;color:#4caf50;}
            .sc-code{margin:0;padding:14px;background:#1a1d23;color:#c8ccd0;font-family:'Cascadia Code',monospace;font-size:0.8em;white-space:pre-wrap;line-height:1.6;max-height:400px;overflow-y:auto;}
          </style>
        </div>`;
      let activeCat=categories[0];
      const renderList=()=>{
        document.getElementById('sc-list').innerHTML=Object.keys(this.snippets[activeCat]).map(name=>
          `<div class="sc-item" data-name="${name}">${name}</div>`
        ).join('');
        document.getElementById('sc-code-wrap').style.display='none';
      };
      container.querySelectorAll('.sc-tab').forEach(t=>t.addEventListener('click',()=>{
        container.querySelectorAll('.sc-tab').forEach(b=>b.classList.remove('active'));t.classList.add('active');
        activeCat=t.dataset.cat;renderList();
      }));
      document.getElementById('sc-list').addEventListener('click',e=>{
        const item=e.target.closest('.sc-item');if(!item)return;
        container.querySelectorAll('.sc-item').forEach(i=>i.classList.remove('active'));item.classList.add('active');
        const code=this.snippets[activeCat][item.dataset.name];
        document.getElementById('sc-code-title').textContent=item.dataset.name;
        document.getElementById('sc-code').textContent=code;
        document.getElementById('sc-code-wrap').style.display='block';
      });
      document.getElementById('sc-copy').addEventListener('click',()=>{
        navigator.clipboard.writeText(document.getElementById('sc-code').textContent);
        const b=document.getElementById('sc-copy');b.textContent='✅ 已复制';setTimeout(()=>b.textContent='📋 复制代码',1500);
      });
      renderList();
    }
  };
  if(typeof window!=='undefined') window.CodeSnippet=CodeSnippet;
})();
