# Native libraries for the Vercel function

`libatomic.so.1`: pedalboard's native module links against it, and Vercel's
Python runtime image does not have it (the import failed with
`libatomic.so.1: cannot open shared object file`). `processing.py` loads this
copy with `RTLD_GLOBAL` only when the system has none, before pedalboard is
imported. The dynamic loader then matches pedalboard's `NEEDED libatomic.so.1`
by soname.

- From: Ubuntu 26.04 package `libatomic1` 16-20260322-1ubuntu1 (GCC 16), x86_64
- Needs: `libc.so.6` only, symbol versions up to GLIBC_2.14
- sha256: `eac440708f874c4d446671efb5353cebeaa829bd1f18cd8d5065cd6efefa387b`
- Licence: GPL-3.0 with the GCC Runtime Library Exception 3.1, which permits
  shipping it alongside other programs.
