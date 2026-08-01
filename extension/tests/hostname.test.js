import { suite, test, assert } from './testUtil.js';
import { normalizeHostnameInput, normalizeUrl } from '../shared/hostname.js';

suite('Hostname normalization', () => {
  test('accepts full URLs, paths, www and mixed case', () => {
    assert.equal(normalizeHostnameInput(' HTTPS://WWW.YouTube.COM/watch?v=1 '), 'youtube.com');
    assert.equal(normalizeHostnameInput('www.Example.com/path'), 'example.com');
    assert.equal(normalizeHostnameInput('localhost:3000/page'), 'localhost:3000');
  });

  test('rejects unsupported schemes and invalid input', () => {
    assert.equal(normalizeHostnameInput('chrome://settings'), '');
    assert.equal(normalizeHostnameInput('javascript:alert(1)'), '');
    assert.equal(normalizeHostnameInput('bad host.com'), '');
  });

  test('URL normalization preserves encoded query semantics while sorting', () => {
    assert.equal(
      normalizeUrl('https://www.example.com/a/?b=hello%20world&a=%26'),
      'https://example.com/a?a=%26&b=hello+world',
    );
  });
});
