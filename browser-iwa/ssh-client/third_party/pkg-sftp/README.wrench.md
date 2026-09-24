# Local pkg/sftp patch

This directory is based on `github.com/pkg/sftp` v1.13.7 (MIT license; see `LICENSE`). Wrench adds `Client.ReadDirContextLimit`, which rejects an over-limit directory while decoding protocol entries instead of retaining an unbounded `[]os.FileInfo`. The protocol decoder caps each response packet at 256 KiB, which bounds temporary packet memory.

When updating upstream, preserve this limit-aware API and its tests.
