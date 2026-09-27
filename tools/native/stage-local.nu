# Build a host-only processor library for local integration tests.
def main [] {
	let bindings = ($env.FILE_PWD | path dirname | path dirname)
	let mace = ($bindings | path dirname | path join mace)
	let host = $nu.os-info
	let system = match $host.name {
		windows => 'windows'
		macos => 'darwin'
		linux => 'linux'
		_ => { error make { msg: $'Unsupported OS: ($host.name)' } }
	}
	let arch = match $host.arch {
		x86_64 => 'amd64'
		aarch64 => 'arm64'
		_ => { error make { msg: $'Unsupported architecture: ($host.arch)' } }
	}
	let libc = if $system == 'linux' {
		if ('/lib/ld-musl-x86_64.so.1' | path exists) or ('/lib/ld-musl-aarch64.so.1' | path exists) { '-musl' } else { '-glibc' }
	} else { '' }
	let target = $'($system)-($arch)($libc)'
	let library = match $system {
		windows => 'mace_processor.dll'
		darwin => 'libmace_processor.dylib'
		_ => 'libmace_processor.so'
	}
	let temporary = (mktemp -d)
	try {
		let output = ($temporary | path join $library)
		with-env { CGO_ENABLED: '1' } {
			^go -C $mace build -buildmode=c-shared -o $output ./cmd/processor-abi
		}
		for destination in [
			($bindings | path join packages node bin $target)
			($bindings | path join packages python src mace_python bin $target)
			($bindings | path join packages dart bin $target)
		] {
			mkdir $destination
			cp $output ($destination | path join $library)
		}
	} catch {|failure|
		rm -r $temporary
		error make { msg: $'Native staging failed: ($failure)' }
	}
	rm -r $temporary
}
