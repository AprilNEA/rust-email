# Rust Email

## Usage

```bash
pnpm i
```

### Askama
```tsx
import { AskamaWrapper } from "rust-email/askama";


export default AskamaWrapper(
  WelcomeEmail,
  { userName: "acme" },
  { useSnakeCase: true }
);
```

## License

MIT License