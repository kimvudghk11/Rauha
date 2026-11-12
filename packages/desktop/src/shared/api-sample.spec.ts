import { describe, expect, it } from 'vitest';
import { ExampleValue, parseRules } from './api-sample.js';

const field = (name: string, type: string, rules = '', optional = false) => ({ name, type, rules: parseRules(rules), optional });

describe('예시 값(모델 없이 이름·타입·검증 규칙으로)', () => {
  it('@IsEmail·@Email 이 붙은 글자는 user@example.com', () => {
    expect(ExampleValue.forField(field('contact', 'string', '@IsEmail()'))).toBe('user@example.com');
    expect(ExampleValue.forField(field('mail', 'String', '@NotBlank @Email'))).toBe('user@example.com');
  });

  it('검증 규칙이 없어도 이름이 email·password·phone 이면 그 모양', () => {
    expect(ExampleValue.forField(field('email', 'string'))).toBe('user@example.com');
    expect(ExampleValue.forField(field('password', 'string'))).toBe('Passw0rd!');
    expect(ExampleValue.forField(field('phoneNumber', 'string'))).toBe('010-1234-5678');
  });

  it('@IsUUID·UUID 타입은 UUID, @IsDateString·Date 타입은 ISO 날짜', () => {
    expect(ExampleValue.forField(field('ref', 'string', '@IsUUID()'))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(ExampleValue.forField(field('ref', 'UUID'))).toMatch(/^[0-9a-f]{8}-/);
    expect(ExampleValue.forField(field('startsAt', 'string', '@IsDateString()'))).toBe('2026-01-15T09:00:00.000Z');
    expect(ExampleValue.forField(field('birthday', 'LocalDate'))).toBe('2026-01-15');
  });

  it('@Min·@Max 범위 안의 숫자를 고른다', () => {
    expect(ExampleValue.forField(field('age', 'number', '@IsInt() @Min(18) @Max(99)'))).toBe(30);
    expect(ExampleValue.forField(field('level', 'int', '@Min(5)'))).toBe(5);
    expect(ExampleValue.forField(field('level', 'number', '@Max(0)'))).toBe(0);
    expect(ExampleValue.forField(field('limit', 'number'))).toBe(10);
  });

  it('@Length·@Size·@MinLength 길이에 맞춘 글자', () => {
    const v = ExampleValue.forField(field('code', 'string', '@Length(8, 8)')) as string;
    expect(v).toHaveLength(8);
    expect((ExampleValue.forField(field('name', 'String', '@Size(min = 12, max = 20)')) as string).length).toBeGreaterThanOrEqual(12);
    expect((ExampleValue.forField(field('title', 'string', '@MaxLength(3)')) as string).length).toBeLessThanOrEqual(3);
  });

  it('@IsEnum(이름)·@IsIn([…]) 은 첫 값, @ApiProperty example 은 그 값을 쓴다', () => {
    expect(ExampleValue.forField(field('role', 'string', '@IsEnum(Role)'), new Map([['Role', ['admin', 'member']]]))).toBe('admin');
    expect(ExampleValue.forField(field('plan', 'string', "@IsIn(['basic', 'pro'])"))).toBe('basic');
    expect(ExampleValue.forField(field('planId', 'string', "@ApiProperty({ example: 'p1' })"))).toBe('p1');
    expect(ExampleValue.forField(field('qty', 'number', '@ApiProperty({ example: 3 })'))).toBe(3);
  });

  it('enum 타입 이름이면 첫 값', () => {
    expect(ExampleValue.forField(field('status', 'Status'), new Map([['Status', ['ACTIVE', 'PAUSED']]]))).toBe('ACTIVE');
  });

  it('알 수 없는 타입은 undefined(부르는 쪽이 클래스 모양을 찾는다)', () => {
    expect(ExampleValue.forField(field('owner', 'UserDto'))).toBeUndefined();
  });

  it('경로·쿼리 값은 글자로: id 숫자면 1, ParseUUIDPipe 면 UUID, 기본값이 있으면 그 값', () => {
    expect(ExampleValue.forParam('id', 'number')).toBe('1');
    expect(ExampleValue.forParam('id', 'string', ['ParseUUIDPipe'])).toMatch(/^[0-9a-f]{8}-/);
    expect(ExampleValue.forParam('page', 'int', [], '0')).toBe('0');
    expect(ExampleValue.forParam('keyword', 'string')).toBe('sample');
  });
});
