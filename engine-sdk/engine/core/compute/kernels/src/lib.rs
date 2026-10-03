// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
//! Allocation-free bulk kernels. The host validates and owns every memory range.
//! Instances have separate stack globals; shared instances never own mutable statics.
#![no_std]
#![feature(core_intrinsics)]
#![allow(internal_features)]

use core::panic::PanicInfo;
#[cfg(target_feature = "atomics")]
use core::sync::atomic::{AtomicU32, Ordering};
#[cfg(target_feature = "simd128")]
use core::arch::wasm32::*;

#[panic_handler]
fn panic(_: &PanicInfo) -> ! { core::arch::wasm32::unreachable() }

#[inline]
fn cancelled(ptr: u32, index: usize) -> bool {
    #[cfg(target_feature = "atomics")]
    { ptr != 0 && index & 1023 == 0 && unsafe { (&*(ptr as *const AtomicU32)).load(Ordering::Relaxed) != 0 } }
    #[cfg(not(target_feature = "atomics"))]
    { let _ = (ptr, index); false }
}

#[inline]
fn sqrt(value: f64) -> f64 { core::intrinsics::sqrtf64(value) }

// Rust min/max may pick either zero on ties; the public JS helpers require
// Math.min(+0, -0) == -0 and Math.max(+0, -0) == +0 for finite samples.
#[inline]
fn finite_min(a: f64, b: f64) -> f64 {
    if a == 0.0 && b == 0.0 { f64::from_bits(a.to_bits() | b.to_bits()) }
    else if a < b { a } else { b }
}

#[inline]
fn finite_max(a: f64, b: f64) -> f64 {
    if a == 0.0 && b == 0.0 { f64::from_bits(a.to_bits() & b.to_bits()) }
    else if a > b { a } else { b }
}

#[unsafe(no_mangle)]
pub extern "C" fn abi_version() -> u32 { 1 }

#[unsafe(no_mangle)]
pub unsafe extern "C" fn stats(ptr: *const f64, n: usize, out: *mut f64, cancel: u32) -> u32 {
    let mut sum = 0.0;
    let mut m2 = 0.0;
    let mut min = if n == 0 { 0.0 } else { unsafe { *ptr } };
    let mut max = min;
    for i in 0..n {
        if cancelled(cancel, i) { return 1; }
        let x = unsafe { *ptr.add(i) };
        sum += x;
        if x < min { min = x; } if x > max { max = x; }
    }
    let mean = if n == 0 { 0.0 } else { sum / n as f64 };
    for i in 0..n {
        if cancelled(cancel, i) { return 1; }
        let d = unsafe { *ptr.add(i) } - mean;
        m2 += d * d;
    }
    let values = [sum, mean, if n > 1 { m2 / (n - 1) as f64 } else { 0.0 },
        if n > 0 { m2 / n as f64 } else { 0.0 }, min, max];
    for (i, x) in values.iter().enumerate() { unsafe { *out.add(i) = *x; } }
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn compensated_sum(ptr: *const f64, n: usize, out: *mut f64, cancel: u32) -> u32 {
    let mut sum: f64 = 0.0;
    let mut correction = 0.0;
    let mut absolute = 0.0;
    for i in 0..n {
        if cancelled(cancel, i) { return 1; }
        let x = unsafe { *ptr.add(i) };
        let next = sum + x;
        correction += if sum.abs() >= x.abs() { (sum - next) + x } else { (x - next) + sum };
        sum = next;
        absolute += x.abs();
    }
    for (i, x) in [sum, correction, sum + correction, absolute].iter().enumerate() {
        unsafe { *out.add(i) = *x; }
    }
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bounds(ptr: *const f64, n: usize, components: usize, out: *mut f64, cancel: u32) -> u32 {
    for c in 0..components {
        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;
        for i in 0..n {
            if cancelled(cancel, i) { return 1; }
            let x = unsafe { *ptr.add(i * components + c) };
            if x.is_finite() { min = finite_min(min, x); max = finite_max(max, x); }
        }
        unsafe { *out.add(c) = if min.is_finite() { min } else { 0.0 };
            *out.add(components + c) = if max.is_finite() { max } else { 0.0 }; }
    }
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn transform_points(ptr: *const f64, n: usize, matrix: *const f64, out: *mut f64, cancel: u32) -> u32 {
    let m = unsafe { core::slice::from_raw_parts(matrix, 16) };
    for i in 0..n {
        if cancelled(cancel, i) { return 1; }
        let (x, y, z) = unsafe { (*ptr.add(i * 3), *ptr.add(i * 3 + 1), *ptr.add(i * 3 + 2)) };
        let w = m[3] * x + m[7] * y + m[11] * z + m[15];
        let inv = if w.abs() < 1e-6 { 1.0 } else { 1.0 / w };
        #[cfg(target_feature = "simd128")]
        unsafe {
            let xy = f64x2_add(f64x2_add(f64x2_add(f64x2_mul(v128_load(matrix.cast()), f64x2_splat(x)),
                f64x2_mul(v128_load(matrix.add(4).cast()), f64x2_splat(y))),
                f64x2_mul(v128_load(matrix.add(8).cast()), f64x2_splat(z))), v128_load(matrix.add(12).cast()));
            v128_store(out.add(i * 3).cast(), f64x2_mul(xy, f64x2_splat(inv)));
        }
        #[cfg(not(target_feature = "simd128"))]
        unsafe {
            *out.add(i * 3) = (m[0] * x + m[4] * y + m[8] * z + m[12]) * inv;
            *out.add(i * 3 + 1) = (m[1] * x + m[5] * y + m[9] * z + m[13]) * inv;
        }
        unsafe { *out.add(i * 3 + 2) = (m[2] * x + m[6] * y + m[10] * z + m[14]) * inv; }
    }
    0
}

#[inline]
fn luma(r: u8, g: u8, b: u8, c0: f64, c1: f64, c2: f64) -> f64 { r as f64 * c0 + g as f64 * c1 + b as f64 * c2 }

#[unsafe(no_mangle)]
pub unsafe extern "C" fn rgba_histogram(ptr: *const u8, n: usize, out: *mut u32, c0: f64, c1: f64, c2: f64, cancel: u32) -> u32 {
    for i in 0..1280 { unsafe { *out.add(i) = 0; } }
    for i in 0..n {
        if cancelled(cancel, i) { return 1; }
        for c in 0..4 {
            let bin = unsafe { *ptr.add(i * 4 + c) } as usize;
            unsafe { *out.add(c * 256 + bin) += 1; }
        }
        let value = unsafe { luma(*ptr.add(i * 4), *ptr.add(i * 4 + 1), *ptr.add(i * 4 + 2), c0, c1, c2) };
        let bin = if value.is_finite() { (value.clamp(0.0, 255.0) + 0.5) as usize } else { 0 };
        unsafe { *out.add(1024 + bin) += 1; }
    }
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn luminance(ptr: *const u8, n: usize, out: *mut f32, c0: f64, c1: f64, c2: f64, scale: f64, cancel: u32) -> u32 {
    let mut start = 0;
    #[cfg(target_feature = "simd128")]
    unsafe {
        while start + 1 < n {
            if cancelled(cancel, start) { return 1; }
            let r = f64x2(*ptr.add(start * 4) as f64, *ptr.add(start * 4 + 4) as f64);
            let g = f64x2(*ptr.add(start * 4 + 1) as f64, *ptr.add(start * 4 + 5) as f64);
            let b = f64x2(*ptr.add(start * 4 + 2) as f64, *ptr.add(start * 4 + 6) as f64);
            let values = f64x2_mul(f64x2_add(f64x2_add(f64x2_mul(r, f64x2_splat(c0)),
                f64x2_mul(g, f64x2_splat(c1))), f64x2_mul(b, f64x2_splat(c2))), f64x2_splat(scale));
            *out.add(start) = f64x2_extract_lane::<0>(values) as f32;
            *out.add(start + 1) = f64x2_extract_lane::<1>(values) as f32;
            start += 2;
        }
    }
    for i in start..n {
        if cancelled(cancel, i) { return 1; }
        let value = unsafe { luma(*ptr.add(i * 4), *ptr.add(i * 4 + 1), *ptr.add(i * 4 + 2), c0, c1, c2) };
        unsafe { *out.add(i) = (value * scale) as f32; }
    }
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn fft(real: *mut f64, imag: *mut f64, n: usize, twiddles: *const f64, inverse: u32, cancel: u32) -> u32 {
    let mut j = 0;
    for i in 1..n {
        if cancelled(cancel, i) { return 1; }
        let mut bit = n >> 1;
        while j & bit != 0 { j ^= bit; bit >>= 1; }
        j ^= bit;
        if i < j { unsafe { core::ptr::swap(real.add(i), real.add(j)); core::ptr::swap(imag.add(i), imag.add(j)); } }
    }
    let mut width = 2;
    while width <= n {
        let half = width / 2;
        for start in (0..n).step_by(width) {
            for k in 0..half {
                if cancelled(cancel, start + k) { return 1; }
                let t = k * (n / width) * 2;
                let wr = unsafe { *twiddles.add(t) };
                let wi = unsafe { *twiddles.add(t + 1) } * if inverse == 0 { -1.0 } else { 1.0 };
                let a = start + k;
                let b = a + half;
                unsafe {
                    let tr = wr * *real.add(b) - wi * *imag.add(b);
                    let ti = wr * *imag.add(b) + wi * *real.add(b);
                    *real.add(b) = *real.add(a) - tr;
                    *imag.add(b) = *imag.add(a) - ti;
                    *real.add(a) += tr;
                    *imag.add(a) += ti;
                }
            }
        }
        if width == n { break; }
        width *= 2;
    }
    if inverse != 0 {
        for i in 0..n {
            if cancelled(cancel, i) { return 1; }
            unsafe { *real.add(i) /= n as f64; *imag.add(i) /= n as f64; }
        }
    }
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn waveform(ptr: *const f64, n: usize, buckets: usize, out: *mut f64, cancel: u32) -> u32 {
    for b in 0..buckets {
        if cancelled(cancel, b) { return 1; }
        // Both lengths fit the host arena, but their product can exceed wasm32.
        let start = (b as u64 * n as u64 / buckets as u64) as usize;
        let boundary = ((b + 1) as u64 * n as u64 / buckets as u64) as usize;
        let end = n.min((start + 1).max(boundary));
        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;
        let mut peak: f64 = 0.0;
        for i in start..end {
            if cancelled(cancel, i) { return 1; }
            let x = unsafe { *ptr.add(i) };
            min = finite_min(min, x); max = finite_max(max, x); peak = peak.max(x.abs());
        }
        unsafe { *out.add(b * 3) = if start < end { min } else { 0.0 };
            *out.add(b * 3 + 1) = if start < end { max } else { 0.0 };
            *out.add(b * 3 + 2) = peak; }
    }
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn windowed_rms(ptr: *const f64, n: usize, window: usize, hop: usize, out: *mut f64, cancel: u32) -> u32 {
    for (frame, start) in (0..n).step_by(hop).enumerate() {
        let end = n.min(start + window);
        let mut squares = 0.0;
        let mut peak: f64 = 0.0;
        for i in start..end {
            if cancelled(cancel, i) { return 1; }
            let x = unsafe { *ptr.add(i) };
            squares += x * x; peak = peak.max(x.abs());
        }
        unsafe { *out.add(frame * 2) = sqrt(squares / (end - start) as f64); *out.add(frame * 2 + 1) = peak; }
    }
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn crc32(ptr: *const u8, n: usize, previous: u32, cancel: u32) -> u32 {
    let mut crc = previous ^ 0xffff_ffff;
    for i in 0..n {
        if cancelled(cancel, i) { return 0; }
        crc ^= unsafe { *ptr.add(i) } as u32;
        for _ in 0..8 { crc = (crc >> 1) ^ (0xedb8_8320 & 0u32.wrapping_sub(crc & 1)); }
    }
    crc ^ 0xffff_ffff
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn byte_histogram(ptr: *const u8, n: usize, out: *mut u32, cancel: u32) -> u32 {
    for i in 0..256 { unsafe { *out.add(i) = 0; } }
    for i in 0..n {
        if cancelled(cancel, i) { return 1; }
        unsafe { *out.add(*ptr.add(i) as usize) += 1; }
    }
    0
}
