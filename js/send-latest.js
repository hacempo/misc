const fs = require('fs');
const path = require('path');

(async () => {
  const root = 'G:\\h\\h';
  const token = process.env.TOKEN;

  for (const line of fs.readFileSync('result.txt', 'utf8').split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^(.*?)\s+(https?:\/\/\S+)\s*$/);
    if (!match) {
      console.log(`格式错误：${line}`);
      continue;
    }

    const title = match[1].trim().replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/, '');
    const url = match[2];
    const dir = path.join(root, title);

    fs.mkdirSync(dir, { recursive: true });

    try {
      const res = await fetch('http://127.0.0.1:29000/jsonrpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'download',
          method: 'aria2.addUri',
          params: [
            `token:${token}`,
            [url],
            {
              dir,
              'max-tries': '5',
              'retry-wait': '5',
              'connect-timeout': '20',
              timeout: '60',
              continue: 'true',
              'auto-file-renaming': 'false'
            }
          ]
        })
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      console.log(`已提交：${title}`);
    } catch (e) {
      console.log(`提交失败：${title}，${e.message}`);
    }
  }
})();