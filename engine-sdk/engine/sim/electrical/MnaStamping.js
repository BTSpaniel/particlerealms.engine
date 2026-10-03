// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { solveDeterministicLinearSystem } from './DeterministicLU.js';

function requireSize(value) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 128) {
        throw new RangeError('MNA size must be a safe integer in [1, 128]');
    }
    return value;
}

function finite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new RangeError(label + ' must be finite');
    }
    return value;
}

function positive(value, label) {
    const result = finite(value, label);
    if (!(result > 0)) throw new RangeError(label + ' must be positive');
    return result;
}

export class MnaStamping {
    constructor(size) {
        this.size = requireSize(size);
        this.matrix = new Float64Array(this.size * this.size);
        this.rightHandSide = new Float64Array(this.size);
    }

    reset() {
        this.matrix.fill(0);
        this.rightHandSide.fill(0);
        return this;
    }

    _index(index, label, allowReference = false) {
        if (allowReference && index === -1) return -1;
        if (!Number.isSafeInteger(index) || index < 0 || index >= this.size) {
            throw new RangeError(label + ' is outside the MNA system');
        }
        return index;
    }

    addMatrix(row, column, value) {
        const r = this._index(row, 'matrix row');
        const c = this._index(column, 'matrix column');
        const index = r * this.size + c;
        this.matrix[index] = finite(this.matrix[index] + finite(value, 'matrix stamp'), 'matrix entry');
        return this;
    }

    addRightHandSide(row, value) {
        const r = this._index(row, 'right-hand-side row');
        this.rightHandSide[r] = finite(
            this.rightHandSide[r] + finite(value, 'right-hand-side stamp'),
            'right-hand-side entry',
        );
        return this;
    }

    stampConductance(positiveNode, negativeNode, conductanceSiemens) {
        const positiveIndex = this._index(positiveNode, 'positive node', true);
        const negativeIndex = this._index(negativeNode, 'negative node', true);
        const conductance = finite(conductanceSiemens, 'conductanceSiemens');
        if (conductance < 0) throw new RangeError('conductanceSiemens must be non-negative');
        if (conductance === 0) return this;
        if (positiveIndex >= 0) this.addMatrix(positiveIndex, positiveIndex, conductance);
        if (negativeIndex >= 0) this.addMatrix(negativeIndex, negativeIndex, conductance);
        if (positiveIndex >= 0 && negativeIndex >= 0) {
            this.addMatrix(positiveIndex, negativeIndex, -conductance);
            this.addMatrix(negativeIndex, positiveIndex, -conductance);
        }
        return this;
    }

    /** Current is positive from positiveNode to negativeNode. */
    stampCurrentSource(positiveNode, negativeNode, currentAmps) {
        const positiveIndex = this._index(positiveNode, 'positive node', true);
        const negativeIndex = this._index(negativeNode, 'negative node', true);
        const current = finite(currentAmps, 'currentAmps');
        if (positiveIndex >= 0) this.addRightHandSide(positiveIndex, -current);
        if (negativeIndex >= 0) this.addRightHandSide(negativeIndex, current);
        return this;
    }

    /** Stamp I = G*V + Ioffset from positive to negative. */
    stampAffineConductance(positiveNode, negativeNode, conductanceSiemens, currentOffsetAmps = 0) {
        this.stampConductance(positiveNode, negativeNode, conductanceSiemens);
        this.stampCurrentSource(positiveNode, negativeNode, currentOffsetAmps);
        return this;
    }

    stampVoltageBranch(
        positiveNode,
        negativeNode,
        branchIndex,
        voltageVolts,
        seriesResistanceOhms = 0,
    ) {
        const positiveIndex = this._index(positiveNode, 'positive node', true);
        const negativeIndex = this._index(negativeNode, 'negative node', true);
        const branch = this._index(branchIndex, 'branch index');
        const voltage = finite(voltageVolts, 'voltageVolts');
        const resistance = finite(seriesResistanceOhms, 'seriesResistanceOhms');
        if (resistance < 0) throw new RangeError('seriesResistanceOhms must be non-negative');
        if (positiveIndex >= 0) {
            this.addMatrix(positiveIndex, branch, 1);
            this.addMatrix(branch, positiveIndex, 1);
        }
        if (negativeIndex >= 0) {
            this.addMatrix(negativeIndex, branch, -1);
            this.addMatrix(branch, negativeIndex, -1);
        }
        if (resistance !== 0) this.addMatrix(branch, branch, -resistance);
        this.addRightHandSide(branch, voltage);
        return this;
    }

    stampBranchCurrentConstraint(positiveNode, negativeNode, branchIndex, currentAmps) {
        const positiveIndex = this._index(positiveNode, 'positive node', true);
        const negativeIndex = this._index(negativeNode, 'negative node', true);
        const branch = this._index(branchIndex, 'branch index');
        if (positiveIndex >= 0) this.addMatrix(positiveIndex, branch, 1);
        if (negativeIndex >= 0) this.addMatrix(negativeIndex, branch, -1);
        this.addMatrix(branch, branch, 1);
        this.addRightHandSide(branch, finite(currentAmps, 'constrained currentAmps'));
        return this;
    }

    stampCapacitorBackwardEuler(positiveNode, negativeNode, capacitanceFarads, h, previousVoltageVolts) {
        const conductance = positive(capacitanceFarads, 'capacitanceFarads') / positive(h, 'capacitor h');
        const previousVoltage = finite(previousVoltageVolts, 'previousVoltageVolts');
        this.stampConductance(positiveNode, negativeNode, conductance);
        this.stampCurrentSource(positiveNode, negativeNode, -conductance * previousVoltage);
        return this;
    }

    stampInductorBackwardEuler(
        positiveNode,
        negativeNode,
        branchIndex,
        inductanceHenries,
        h,
        previousCurrentAmps,
        seriesResistanceOhms = 0,
        seriesVoltageVolts = 0,
    ) {
        const inductiveResistance = positive(inductanceHenries, 'inductanceHenries') /
            positive(h, 'inductor h');
        const previousCurrent = finite(previousCurrentAmps, 'previousCurrentAmps');
        this.stampVoltageBranch(
            positiveNode,
            negativeNode,
            branchIndex,
            finite(seriesVoltageVolts, 'seriesVoltageVolts'),
            finite(seriesResistanceOhms, 'seriesResistanceOhms') + inductiveResistance,
        );
        this.addRightHandSide(branchIndex, -inductiveResistance * previousCurrent);
        return this;
    }

    stampCoupledInductorsBackwardEuler({
        primaryPositive,
        primaryNegative,
        secondaryPositive,
        secondaryNegative,
        primaryBranch,
        secondaryBranch,
        primaryInductanceHenries,
        secondaryInductanceHenries,
        mutualInductanceHenries,
        primaryResistanceOhms = 0,
        secondaryResistanceOhms = 0,
        previousPrimaryCurrentAmps = 0,
        previousSecondaryCurrentAmps = 0,
        h,
    }) {
        const dt = positive(h, 'coupled-inductor h');
        const primaryL = positive(primaryInductanceHenries, 'primaryInductanceHenries');
        const secondaryL = positive(secondaryInductanceHenries, 'secondaryInductanceHenries');
        const mutual = finite(mutualInductanceHenries, 'mutualInductanceHenries');
        if (Math.abs(mutual) > Math.sqrt(primaryL * secondaryL)) {
            throw new RangeError('mutualInductanceHenries exceeds the physical coupling bound');
        }
        this.stampInductorBackwardEuler(
            primaryPositive,
            primaryNegative,
            primaryBranch,
            primaryL,
            dt,
            previousPrimaryCurrentAmps,
            primaryResistanceOhms,
        );
        this.stampInductorBackwardEuler(
            secondaryPositive,
            secondaryNegative,
            secondaryBranch,
            secondaryL,
            dt,
            previousSecondaryCurrentAmps,
            secondaryResistanceOhms,
        );
        const mutualResistance = mutual / dt;
        this.addMatrix(primaryBranch, secondaryBranch, -mutualResistance);
        this.addMatrix(secondaryBranch, primaryBranch, -mutualResistance);
        this.addRightHandSide(primaryBranch, -mutualResistance * previousSecondaryCurrentAmps);
        this.addRightHandSide(secondaryBranch, -mutualResistance * previousPrimaryCurrentAmps);
        return this;
    }

    stampVccs(outputPositive, outputNegative, controlPositive, controlNegative, gainSiemens) {
        const op = this._index(outputPositive, 'VCCS output positive', true);
        const on = this._index(outputNegative, 'VCCS output negative', true);
        const cp = this._index(controlPositive, 'VCCS control positive', true);
        const cn = this._index(controlNegative, 'VCCS control negative', true);
        const gain = finite(gainSiemens, 'VCCS gainSiemens');
        if (op >= 0 && cp >= 0) this.addMatrix(op, cp, gain);
        if (op >= 0 && cn >= 0) this.addMatrix(op, cn, -gain);
        if (on >= 0 && cp >= 0) this.addMatrix(on, cp, -gain);
        if (on >= 0 && cn >= 0) this.addMatrix(on, cn, gain);
        return this;
    }

    stampVcvs(outputPositive, outputNegative, controlPositive, controlNegative, branchIndex, gain) {
        this.stampVoltageBranch(outputPositive, outputNegative, branchIndex, 0, 0);
        const cp = this._index(controlPositive, 'VCVS control positive', true);
        const cn = this._index(controlNegative, 'VCVS control negative', true);
        const value = finite(gain, 'VCVS gain');
        if (cp >= 0) this.addMatrix(branchIndex, cp, -value);
        if (cn >= 0) this.addMatrix(branchIndex, cn, value);
        return this;
    }

    stampCccs(outputPositive, outputNegative, controlBranchIndex, gain) {
        const op = this._index(outputPositive, 'CCCS output positive', true);
        const on = this._index(outputNegative, 'CCCS output negative', true);
        const control = this._index(controlBranchIndex, 'CCCS control branch');
        const value = finite(gain, 'CCCS gain');
        if (op >= 0) this.addMatrix(op, control, value);
        if (on >= 0) this.addMatrix(on, control, -value);
        return this;
    }

    stampCcvs(outputPositive, outputNegative, branchIndex, controlBranchIndex, transresistanceOhms) {
        this.stampVoltageBranch(outputPositive, outputNegative, branchIndex, 0, 0);
        this.addMatrix(
            branchIndex,
            this._index(controlBranchIndex, 'CCVS control branch'),
            -finite(transresistanceOhms, 'CCVS transresistanceOhms'),
        );
        return this;
    }

    stampIdealTransformer({
        primaryPositive,
        primaryNegative,
        secondaryPositive,
        secondaryNegative,
        primaryBranch,
        secondaryBranch,
        turnsRatio,
        primaryResistanceOhms = 0,
        secondaryResistanceOhms = 0,
    }) {
        const ratio = finite(turnsRatio, 'transformer turnsRatio');
        if (ratio === 0) throw new RangeError('transformer turnsRatio must be non-zero');
        const pp = this._index(primaryPositive, 'transformer primary positive', true);
        const pn = this._index(primaryNegative, 'transformer primary negative', true);
        const sp = this._index(secondaryPositive, 'transformer secondary positive', true);
        const sn = this._index(secondaryNegative, 'transformer secondary negative', true);
        const pb = this._index(primaryBranch, 'transformer primary branch');
        const sb = this._index(secondaryBranch, 'transformer secondary branch');

        if (pp >= 0) this.addMatrix(pp, pb, 1);
        if (pn >= 0) this.addMatrix(pn, pb, -1);
        if (sp >= 0) this.addMatrix(sp, sb, 1);
        if (sn >= 0) this.addMatrix(sn, sb, -1);

        // Winding voltage relation including series copper drops.
        if (pp >= 0) this.addMatrix(pb, pp, 1);
        if (pn >= 0) this.addMatrix(pb, pn, -1);
        if (sp >= 0) this.addMatrix(pb, sp, -ratio);
        if (sn >= 0) this.addMatrix(pb, sn, ratio);
        this.addMatrix(pb, pb, -finite(primaryResistanceOhms, 'primaryResistanceOhms'));
        this.addMatrix(pb, sb, ratio * finite(secondaryResistanceOhms, 'secondaryResistanceOhms'));

        // Ampere-turn balance: ratio * primary current + secondary current = 0.
        this.addMatrix(sb, pb, ratio);
        this.addMatrix(sb, sb, 1);
        return this;
    }

    stampTransformerBackwardEuler({
        primaryPositive,
        primaryNegative,
        secondaryPositive,
        secondaryNegative,
        primaryBranch,
        secondaryBranch,
        turnsRatio,
        magnetizingInductanceHenries,
        previousMagnetizingCurrentAmps = 0,
        primaryResistanceOhms = 0,
        secondaryResistanceOhms = 0,
        h,
    }) {
        if (magnetizingInductanceHenries == null) {
            return this.stampIdealTransformer({
                primaryPositive,
                primaryNegative,
                secondaryPositive,
                secondaryNegative,
                primaryBranch,
                secondaryBranch,
                turnsRatio,
                primaryResistanceOhms,
                secondaryResistanceOhms,
            });
        }
        const ratio = finite(turnsRatio, 'transformer turnsRatio');
        if (ratio === 0) throw new RangeError('transformer turnsRatio must be non-zero');
        const pp = this._index(primaryPositive, 'transformer primary positive', true);
        const pn = this._index(primaryNegative, 'transformer primary negative', true);
        const sp = this._index(secondaryPositive, 'transformer secondary positive', true);
        const sn = this._index(secondaryNegative, 'transformer secondary negative', true);
        const pb = this._index(primaryBranch, 'transformer primary branch');
        const sb = this._index(secondaryBranch, 'transformer secondary branch');
        const primaryResistance = finite(primaryResistanceOhms, 'primaryResistanceOhms');
        const secondaryResistance = finite(secondaryResistanceOhms, 'secondaryResistanceOhms');
        const inductiveResistance = positive(
            magnetizingInductanceHenries,
            'magnetizingInductanceHenries',
        ) / positive(h, 'transformer h');
        const previousMagnetizingCurrent = finite(
            previousMagnetizingCurrentAmps,
            'previousMagnetizingCurrentAmps',
        );

        if (pp >= 0) this.addMatrix(pp, pb, 1);
        if (pn >= 0) this.addMatrix(pn, pb, -1);
        if (sp >= 0) this.addMatrix(sp, sb, 1);
        if (sn >= 0) this.addMatrix(sn, sb, -1);

        // Internal winding voltage ratio.
        if (pp >= 0) this.addMatrix(pb, pp, 1);
        if (pn >= 0) this.addMatrix(pb, pn, -1);
        if (sp >= 0) this.addMatrix(pb, sp, -ratio);
        if (sn >= 0) this.addMatrix(pb, sn, ratio);
        this.addMatrix(pb, pb, -primaryResistance);
        this.addMatrix(pb, sb, ratio * secondaryResistance);

        // Primary internal voltage drives magnetizing current Im = Ip + Is/n.
        if (pp >= 0) this.addMatrix(sb, pp, 1);
        if (pn >= 0) this.addMatrix(sb, pn, -1);
        this.addMatrix(sb, pb, -(primaryResistance + inductiveResistance));
        this.addMatrix(sb, sb, -inductiveResistance / ratio);
        this.addRightHandSide(sb, -inductiveResistance * previousMagnetizingCurrent);
        return this;
    }

    solve(options = {}) {
        return solveDeterministicLinearSystem(
            this.matrix,
            this.rightHandSide,
            this.size,
            options,
        );
    }
}

export function createMnaStamping(size) {
    return new MnaStamping(size);
}

export default createMnaStamping;
