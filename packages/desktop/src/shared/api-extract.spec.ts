import { describe, expect, it } from 'vitest';
import { extractExpress, extractNest, extractNext, extractSpring, stripComments } from './api-extract.js';

const NEST_MAIN = `
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 8080);
}`;

const NEST_CONTROLLER = `
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Payment-Plan')
@ApiBearerAuth()
@Controller('payment/plan')
export class PaymentPlanController {
  constructor(private readonly service: PaymentPlanService) {}

  @Post()
  @ApiOperation({ summary: '플랜 결제' })
  async confirm(@UserId() userId: string, @Body() dto: ConfirmPlanDto): Promise<Summary> {
    return { ok: true };
  }

  @ApiOperation({ summary: '목록' })
  @Get('early-birds')
  async list(@Query() dto: ListDto, @Query('sort') sort?: string) {
    return [];
  }

  // @Get('old')
  // oldOne() {}

  @Patch(':id/paused')
  paused(@Param('id') id: string, @Body('reason') reason: string) {
    const url = 'http://example.com/{x}';
    return url;
  }

  private helper() {
    return 1;
  }
}
`;

const NEST_DTO = `
export class ConfirmPlanDto {
  @ApiProperty({ example: 'p1' })
  @IsString()
  planId: string;

  @IsOptional()
  months?: number;

  autoRenew!: boolean;

  tags: string[];
}
export class ListDto {
  page?: number;
  keyword?: string;
}
`;

describe('NestJS 추출', () => {
  const api = extractNest([
    { path: 'src/main.ts', text: NEST_MAIN },
    { path: 'src/payment/payment-plan.controller.ts', text: NEST_CONTROLLER },
    { path: 'src/payment/dto.ts', text: NEST_DTO },
  ]);
  const group = api.groups[0]!;

  it('컨트롤러 하나가 묶음 하나가 되고 이름은 ApiTags를 쓴다', () => {
    expect(api.groups).toHaveLength(1);
    expect(group.key).toBe('PaymentPlanController');
    expect(group.name).toBe('Payment-Plan');
  });

  it('전역 prefix와 컨트롤러 경로, 메서드 경로를 이어 붙인다', () => {
    expect(group.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(['POST /api/v1/payment/plan', 'GET /api/v1/payment/plan/early-birds', 'PATCH /api/v1/payment/plan/:id/paused']);
  });

  it('주석 처리한 엔드포인트와 일반 메서드는 넣지 않는다', () => {
    expect(group.endpoints.some((e) => e.path.includes('old'))).toBe(false);
    expect(group.endpoints).toHaveLength(3);
  });

  it('ApiOperation summary가 있으면 이름으로, 없으면 핸들러 이름을 쓴다', () => {
    expect(group.endpoints.map((e) => e.name)).toEqual(['플랜 결제', '목록', 'paused']);
  });

  it('@Body() DTO 클래스는 필드 모양에 예시 값을 채운 JSON 이 된다(ApiProperty example·이름·타입)', () => {
    expect(group.endpoints[0]!.body).toEqual({ planId: 'p1', months: 1, autoRenew: false, tags: ['sample'] });
    expect(group.endpoints[2]!.body).toEqual({ reason: 'Sample text' });
  });

  it('class-validator 규칙과 enum 을 읽어 예시 값을 고른다', () => {
    const v = extractNest([
      { path: 'a.controller.ts', text: `@Controller('users')\nexport class UsersController {\n  @Post()\n  create(@Body() dto: CreateUserDto) {}\n}` },
      { path: 'dto.ts', text: `export enum Role { Admin = 'admin', Member = 'member' }\nexport class CreateUserDto {\n  @IsEmail()\n  contact: string;\n  @IsInt() @Min(18) @Max(99)\n  age: number;\n  @IsEnum(Role)\n  role: Role;\n  @IsOptional() @Length(4, 10)\n  nick?: string;\n}` },
    ]);
    expect(v.groups[0]!.endpoints[0]!.body).toEqual({ contact: 'user@example.com', age: 30, role: 'admin', nick: 'sample' });
  });

  it('경로 변수·쿼리에 예시 값을 두고, 핸들러 이름·파일·줄을 남긴다', () => {
    const e = group.endpoints[2]!;
    expect(e.examples).toEqual({ id: '1' });
    expect(e.handler).toBe('paused');
    expect(e.file).toBe('src/payment/payment-plan.controller.ts');
    expect(e.line).toBe(27);
    expect(group.endpoints[1]!.examples).toEqual({ page: '1', keyword: 'sample', sort: 'createdAt' });
  });

  it('@Query() DTO 필드와 @Query(이름)은 쿼리 자리가 된다', () => {
    expect(group.endpoints[1]!.query).toEqual(['page', 'keyword', 'sort']);
    expect(group.endpoints[1]!.body).toBeNull();
  });

  it('ApiBearerAuth가 붙은 컨트롤러는 bearer 인증 자리를 둔다', () => {
    expect(group.endpoints.every((e) => e.bearer)).toBe(true);
  });

  it('listen의 숫자에서 포트를 읽는다', () => {
    expect(api.port).toBe(8080);
  });

  it('URI 버저닝이 켜져 있으면 버전 조각을 붙인다', () => {
    const v = extractNest([
      { path: 'main.ts', text: `app.enableVersioning({ type: VersioningType.URI });` },
      { path: 'a.controller.ts', text: `@Controller({ path: 'cats', version: '1' })\nexport class CatsController {\n  @Get(':id')\n  @Version('2')\n  one() {}\n  @Get()\n  all() {}\n}` },
    ]);
    expect(v.groups[0]!.endpoints.map((e) => e.path)).toEqual(['/v2/cats/:id', '/v1/cats']);
  });
});

describe('Spring 추출', () => {
  const api = extractSpring([
    { path: 'src/main/resources/application.properties', text: 'server.port=9090\nserver.servlet.context-path=/svc' },
    {
      path: 'src/main/java/com/x/UserController.java',
      text: `
@RestController
@RequestMapping("/users")
@Tag(name = "Users")
public class UserController {
  private final UserService service;

  @GetMapping("/{id}")
  @Operation(summary = "사용자 하나")
  public ResponseEntity<UserDto> get(@PathVariable Long id) { return null; }

  @GetMapping
  public List<UserDto> list(@RequestParam(value = "page", required = false) int page, @RequestParam String keyword) { return null; }

  @PostMapping(value = "/", consumes = "application/json")
  public UserDto create(@RequestBody @Valid CreateUserRequest body) { return null; }

  @RequestMapping(value = "/{id}", method = RequestMethod.DELETE)
  public void remove(@PathVariable("id") Long id) {}
}`,
    },
    { path: 'src/main/java/com/x/CreateUserRequest.java', text: 'public class CreateUserRequest {\n  private String name;\n  private Integer age;\n  private List<String> roles;\n  private boolean admin;\n}' },
  ]);
  const group = api.groups[0]!;

  it('@RestController 클래스가 묶음이 되고 클래스 @RequestMapping이 앞에 붙는다', () => {
    expect(group.name).toBe('Users');
    expect(group.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(['GET /svc/users/:id', 'GET /svc/users', 'POST /svc/users', 'DELETE /svc/users/:id']);
  });

  it('@RequestParam은 쿼리 자리, @RequestBody 클래스 필드는 JSON 뼈대가 된다', () => {
    expect(group.endpoints[1]!.query).toEqual(['page', 'keyword']);
    expect(group.endpoints[2]!.body).toEqual({ name: 'kim', age: 30, roles: ['sample'], admin: false });
  });

  it('@PathVariable 타입과 @RequestParam 이름으로 예시 값을 두고 줄을 남긴다', () => {
    expect(group.endpoints[0]!.examples).toEqual({ id: '1' });
    expect(group.endpoints[1]!.examples).toEqual({ page: '1', keyword: 'sample' });
    expect(group.endpoints[0]!.line).toBe(10);
  });

  it('server.port를 포트로 읽는다', () => {
    expect(api.port).toBe(9090);
  });

  it('Operation summary를 이름으로 쓴다', () => {
    expect(group.endpoints[0]!.name).toBe('사용자 하나');
    expect(group.endpoints[1]!.name).toBe('list');
  });
});

describe('Express·Next 추출', () => {
  it('app·router에 붙인 경로만 넣고 axios 같은 호출은 넣지 않는다', () => {
    const api = extractExpress([{ path: 'src/routes/users.js', text: `router.get('/users/:id', h);\nrouter.post("/users", h);\naxios.get('/users');\napp.delete('/x', h);` }]);
    expect(api.groups[0]!.name).toBe('users');
    expect(api.groups[0]!.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(['GET /users/:id', 'POST /users', 'DELETE /x']);
  });

  it('Next.js app/api 라우트 파일은 내보낸 메서드마다 엔드포인트가 된다', () => {
    const api = extractNext([
      { path: 'src/app/api/users/[id]/route.ts', text: 'export async function GET() {}\nexport const DELETE = async () => {};' },
      { path: 'app/(admin)/api/stats/route.ts', text: 'export function POST() {}' },
    ]);
    const all = api.groups.flatMap((g) => g.endpoints.map((e) => `${e.method} ${e.path}`));
    expect(all).toEqual(['GET /api/users/:id', 'DELETE /api/users/:id', 'POST /api/stats']);
  });
});

describe('주석 지우기', () => {
  it('문자열 안의 // 는 남기고 주석만 지운다', () => {
    expect(stripComments(`const a = 'http://x'; // note\n/* b */ c`)).toBe(`const a = 'http://x'; \n c`);
  });
});
