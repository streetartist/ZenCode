import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { readFileTool } from '../../src/tools/read-file.js';
import { writeFileTool } from '../../src/tools/write-file.js';
import { editFileTool } from '../../src/tools/edit-file.js';
import { globTool } from '../../src/tools/glob.js';
import { grepTool } from '../../src/tools/grep.js';
import { bashTool } from '../../src/tools/bash.js';

const TEST_DIR = path.join(os.tmpdir(), 'zencode-test-' + Date.now());

beforeEach(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
});

describe('read-file', () => {
  it('should read a file with line numbers', async () => {
    const testFile = path.join(TEST_DIR, 'test-read.txt');
    await fs.writeFile(testFile, 'line1\nline2\nline3\n');

    const result = await readFileTool.execute({ path: testFile });
    expect(result.content).toContain('line1');
    expect(result.content).toContain('line2');
    expect(result.content).toContain('1\t');
  });

  it('should support offset and limit', async () => {
    const testFile = path.join(TEST_DIR, 'test-read-offset.txt');
    await fs.writeFile(testFile, 'a\nb\nc\nd\ne\n');

    const result = await readFileTool.execute({ path: testFile, offset: 2, limit: 2 });
    expect(result.content).toContain('b');
    expect(result.content).toContain('c');
    expect(result.content).not.toContain('\ta\n');
  });

  it('should handle non-existent file', async () => {
    const result = await readFileTool.execute({ path: path.join(TEST_DIR, 'no-such-file.txt') });
    expect(result.content).toContain('失败');
  });
});

describe('write-file', () => {
  it('should create and write a file', async () => {
    const testFile = path.join(TEST_DIR, 'test-write.txt');
    const result = await writeFileTool.execute({ path: testFile, content: 'hello world' });
    expect(result.content).toContain('已写入');

    const content = await fs.readFile(testFile, 'utf-8');
    expect(content).toBe('hello world');
  });

  it('should create parent directories', async () => {
    const testFile = path.join(TEST_DIR, 'sub', 'dir', 'test.txt');
    const result = await writeFileTool.execute({ path: testFile, content: 'nested' });
    expect(result.content).toContain('已写入');

    const content = await fs.readFile(testFile, 'utf-8');
    expect(content).toBe('nested');
  });
});

describe('edit-file', () => {
  it('should replace unique string', async () => {
    const testFile = path.join(TEST_DIR, 'test-edit.txt');
    await fs.writeFile(testFile, 'hello world\nfoo bar\n');

    const result = await editFileTool.execute({
      path: testFile,
      old_string: 'foo bar',
      new_string: 'baz qux',
    });
    expect(result.content).toContain('已编辑');

    const content = await fs.readFile(testFile, 'utf-8');
    expect(content).toContain('baz qux');
    expect(content).not.toContain('foo bar');
  });

  it('should reject non-unique match', async () => {
    const testFile = path.join(TEST_DIR, 'test-edit-dup.txt');
    await fs.writeFile(testFile, 'abc\nabc\n');

    const result = await editFileTool.execute({
      path: testFile,
      old_string: 'abc',
      new_string: 'xyz',
    });
    expect(result.content).toContain('不唯一');
  });

  it('should support replace_all', async () => {
    const testFile = path.join(TEST_DIR, 'test-edit-all.txt');
    await fs.writeFile(testFile, 'abc\nabc\nabc\n');

    const result = await editFileTool.execute({
      path: testFile,
      old_string: 'abc',
      new_string: 'xyz',
      replace_all: true,
    });
    expect(result.content).toContain('3');

    const content = await fs.readFile(testFile, 'utf-8');
    expect(content).toBe('xyz\nxyz\nxyz\n');
  });
});

describe('glob', () => {
  it('should find matching files', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'a.ts'), '');
    await fs.writeFile(path.join(TEST_DIR, 'b.ts'), '');
    await fs.writeFile(path.join(TEST_DIR, 'c.js'), '');

    const result = await globTool.execute({ pattern: '*.ts', cwd: TEST_DIR });
    expect(result.content).toContain('a.ts');
    expect(result.content).toContain('b.ts');
    expect(result.content).not.toContain('c.js');
  });
});

describe('grep', () => {
  it('should find matching content', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'search.ts'), 'const foo = 1;\nconst bar = 2;\n');

    const result = await grepTool.execute({ pattern: 'foo', path: TEST_DIR });
    expect(result.content).toContain('foo');
    expect(result.content).toContain('search.ts');
  });

  it('should support case insensitive search', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'case.ts'), 'Hello World\n');

    const result = await grepTool.execute({ pattern: 'hello', path: TEST_DIR, ignore_case: true });
    expect(result.content).toContain('Hello');
  });
});

describe('bash', () => {
  it('should execute command and return output', async () => {
    const cmd = process.platform === 'win32' ? 'echo hello' : 'echo hello';
    const result = await bashTool.execute({ command: cmd });
    expect(result.content).toContain('hello');
  });
});
