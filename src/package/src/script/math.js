
class Complex {
    constructor(re, im) {
        this.re = re || 0;
        this.im = im || 0;
    }

    add(other) {
        return new Complex(this.re + other.re, this.im + other.im);
    }

    sub(other) {
        return new Complex(this.re - other.re, this.im - other.im);
    }

    mul(other) {
        if (typeof other === 'number') {
            return new Complex(this.re * other, this.im * other);
        }
        return new Complex(
            this.re * other.re - this.im * other.im,
            this.re * other.im + this.im * other.re
        );
    }

    conj() {
        return new Complex(this.re, -this.im);
    }

    abs2() {
        return this.re * this.re + this.im * this.im;
    }
}

function vec3Len(v) {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function vec3Normalize(v) {
    const len = vec3Len(v);
    if (len < 1e-10) return [0, 0, 1];
    return [v[0] / len, v[1] / len, v[2] / len];
}

function vec3Cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

function vec3Dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function rodriguesRotate(p, k, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const kCrossP = vec3Cross(k, p);
    const kDotP = vec3Dot(k, p);
    return [
        p[0] * c + kCrossP[0] * s + k[0] * kDotP * (1 - c),
        p[1] * c + kCrossP[1] * s + k[1] * kDotP * (1 - c),
        p[2] * c + kCrossP[2] * s + k[2] * kDotP * (1 - c)
    ];
}

function interpolateVector(current, target, factor) {
    const lenCurrent = vec3Len(current);
    const lenTarget = vec3Len(target);
    const r = lenCurrent + (lenTarget - lenCurrent) * factor;

    if (r < 0.001) return [0, 0, 0];

    const uCurrent = vec3Normalize(current);
    const uTarget = vec3Normalize(target);

    let dot = vec3Dot(uCurrent, uTarget);
    dot = Math.max(-1, Math.min(1, dot));

    if (dot > 0.9999) {
        return [uTarget[0] * r, uTarget[1] * r, uTarget[2] * r];
    }

    if (dot < -0.9999) {
        const perp = Math.abs(uCurrent[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const axis = vec3Normalize(vec3Cross(uCurrent, perp));
        const rot = rodriguesRotate(uCurrent, axis, Math.PI * factor);
        return [rot[0] * r, rot[1] * r, rot[2] * r];
    }

    const omega = Math.acos(dot);
    const sinOmega = Math.sin(omega);
    const stepAngle = factor * omega;
    const t = Math.min(1, stepAngle / omega);
    const s0 = Math.sin((1 - t) * omega) / sinOmega;
    const s1 = Math.sin(t * omega) / sinOmega;

    const dir = vec3Normalize([
        s0 * uCurrent[0] + s1 * uTarget[0],
        s0 * uCurrent[1] + s1 * uTarget[1],
        s0 * uCurrent[2] + s1 * uTarget[2]
    ]);

    return [dir[0] * r, dir[1] * r, dir[2] * r];
}

function mult(A, B) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                sum += A[k * 4 + row] * B[col * 4 + k];
            }
            out[col * 4 + row] = sum;
        }
    }
    return out;
}

function mat4Chain(...matrices) {
    return matrices.reduce(mult);
}

function createPerspectiveMatrix(fovY, aspect, near, far) {
    const f = 1.0 / Math.tan(fovY / 2);
    const nf = 1.0 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = far * nf;
    out[11] = -1.0;
    out[14] = far * near * nf;
    return out;
}

function createTranslationMatrix(x, y, z) {
    const out = new Float32Array(16);
    out[0] = 1.0;
    out[5] = 1.0;
    out[10] = 1.0;
    out[12] = x;
    out[13] = y;
    out[14] = z;
    out[15] = 1.0;
    return out;
}

function mat4RotationX(angle) {
    const out = new Float32Array(16);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    out[0] = 1.0;
    out[5] = c;
    out[6] = s;
    out[9] = -s;
    out[10] = c;
    out[15] = 1.0;
    return out;
}

function mat4RotationY(angle) {
    const out = new Float32Array(16);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    out[0] = c;
    out[2] = -s;
    out[5] = 1.0;
    out[8] = s;
    out[10] = c;
    out[15] = 1.0;
    return out;
}

function mat4RotationZ(angle) {
    const out = new Float32Array(16);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    out[0] = c;
    out[1] = s;
    out[4] = -s;
    out[5] = c;
    out[10] = 1.0;
    out[15] = 1.0;
    return out;
}

function rotateX(matrix, angle) { return mult(matrix, mat4RotationX(angle)); }
function rotateY(matrix, angle) { return mult(matrix, mat4RotationY(angle)); }
function rotateZ(matrix, angle) { return mult(matrix, mat4RotationZ(angle)); }

function rotateMatrix(rotX, rotY, rotZ, base) {
    return mat4Chain(base, mat4RotationX(rotX), mat4RotationY(rotY), mat4RotationZ(rotZ));
}


function projectPoint(p, matrix, width, height) {
    const x = p[0], y = p[1], z = p[2];
    const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];

    if (clipW <= 0) return null;

    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;

    const screenX = (ndcX * 0.5 + 0.5) * width;
    const screenY = (-ndcY * 0.5 + 0.5) * height;

    return [screenX, screenY];
}
