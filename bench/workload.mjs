export const paragraph = '## 章节\n中文English １２３，版本V2。\n\n' +
  '> 引用中文English 456。\n\n' +
  '`inline code` 和 [链接](https://example.org) 介绍。\n\n' +
  '```go\nfmt.Println("中文English")\n```\n\n';

export function fixture(repeat) {
  if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 1000)
    throw new RangeError('repeat must be an integer in [1,1000]');
  return paragraph.repeat(repeat);
}
