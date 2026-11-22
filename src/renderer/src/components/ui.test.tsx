import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Field, Select } from './ui';

/**
 * `Field` 本身渲染的是 `<label>`。Select 早期也套了一层 `<label>`，
 * 点击会被内外两层各自转发一次，原生下拉框打开后立刻关闭（表现为「点了没反应」）；
 * 同时 select 只占了盒子左侧一小块，右侧留白和箭头都在 label 上，点上去同样无响应。
 */
describe('Select', () => {
  const markup = () =>
    renderToStaticMarkup(
      <Field label="来源">
        <Select value="1" onChange={() => undefined}         options={[{ value: '1', label: '示例收藏夹' }]} />
      </Field>
    );

  it('放在 Field 里不会嵌套 label', () => {
    expect(markup().match(/<label/g)).toHaveLength(1);
  });

  it('select 撑满整个盒子，点击区域覆盖右边距', () => {
    const [, selectAttrs] = markup().match(/<select([^>]*)>/) ?? [];
    expect(selectAttrs).toBeDefined();
    expect(selectAttrs).toContain('w-full');
  });
});
