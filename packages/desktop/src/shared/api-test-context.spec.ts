import { describe, expect, it } from 'vitest';
import { pickContextFiles } from './api-test-context.js';

const f = (path: string, text = ''): { path: string; text: string } => ({ path, text });

describe('케이스를 만들 때 모델에게 보여 줄 코드 고르기', () => {
  it('Nest: 컨트롤러가 가져오는 서비스·DTO·가드와 그 서비스가 가져오는 엔티티, 전역 설정(main.ts)을 고른다', () => {
    const files = [
      f('src/users/users.controller.ts', "import { UsersService } from './users.service';\nimport { CreateUserDto } from './dto/create-user.dto';\nimport { AuthGuard } from '../auth/auth.guard';"),
      f('src/users/users.service.ts', "import { User } from './user.entity';\nimport { Mailer } from '../mail/mailer';"),
      f('src/users/dto/create-user.dto.ts'),
      f('src/auth/auth.guard.ts'),
      f('src/users/user.entity.ts'),
      f('src/mail/mailer.ts'),
      f('src/main.ts', 'const app = await NestFactory.create(AppModule); app.useGlobalPipes(new ValidationPipe());'),
      f('src/other/other.controller.ts'),
    ];
    const picked = pickContextFiles('src/users/users.controller.ts', files).map((x) => x.path);
    expect(picked[0]).toBe('src/users/users.controller.ts');
    expect(picked).toEqual(expect.arrayContaining(['src/users/users.service.ts', 'src/users/dto/create-user.dto.ts', 'src/auth/auth.guard.ts', 'src/users/user.entity.ts', 'src/main.ts']));
    expect(picked).not.toContain('src/other/other.controller.ts');
    expect(picked).not.toContain('src/mail/mailer.ts');
  });

  it('Spring: 컨트롤러에 나오는 클래스 이름의 파일과 ServiceImpl, @RestControllerAdvice 를 고른다', () => {
    const files = [
      f('src/main/java/x/UserController.java', 'class UserController { private final UserService service; ResponseEntity<UserDto> create(@RequestBody CreateUserRequest body) }'),
      f('src/main/java/x/UserService.java', 'interface UserService {}'),
      f('src/main/java/x/UserServiceImpl.java', 'class UserServiceImpl implements UserService { UserRepository repo; }'),
      f('src/main/java/x/CreateUserRequest.java'),
      f('src/main/java/x/UserRepository.java'),
      f('src/main/java/x/GlobalHandler.java', '@RestControllerAdvice class GlobalHandler {}'),
      f('src/main/java/x/OrderController.java'),
    ];
    const picked = pickContextFiles('src/main/java/x/UserController.java', files).map((x) => x.path);
    expect(picked).toEqual(expect.arrayContaining(['src/main/java/x/UserService.java', 'src/main/java/x/UserServiceImpl.java', 'src/main/java/x/CreateUserRequest.java', 'src/main/java/x/UserRepository.java', 'src/main/java/x/GlobalHandler.java']));
    expect(picked).not.toContain('src/main/java/x/OrderController.java');
  });

  it('파일 수에는 상한이 있다', () => {
    const many = Array.from({ length: 40 }, (_v, i) => f(`src/a${i}.service.ts`));
    const ctrl = f('src/a.controller.ts', many.map((m) => `import x from './${m.path.slice(4, -3)}';`).join('\n'));
    expect(pickContextFiles('src/a.controller.ts', [ctrl, ...many]).length).toBeLessThanOrEqual(14);
  });
});
