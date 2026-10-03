// Generated from the installed PhysXWasm.idl by tools/generate_physx_types.py.
// Bindings retain the MIT license in notices/bindings-LICENSE.txt.
declare function PhysX(options?: { wasmBinary?: BufferSource; locateFile?: (path: string, prefix: string) => string; print?: (...args: unknown[]) => void; printErr?: (...args: unknown[]) => void }): Promise<typeof PhysX & typeof PhysX.PxTopLevelFunctions>;
export default PhysX;
declare namespace PhysX {
    function destroy(object: object): void;
    function getPointer(object: object): number;
    function _malloc(bytes: number): number;
    function _free(pointer: number): void;
    class VoidPtr { readonly ptr: number; }
    const HEAP8: Int8Array;
    const HEAPU8: Uint8Array;
    const HEAP16: Int16Array;
    const HEAPU16: Uint16Array;
    const HEAP32: Int32Array;
    const HEAPU32: Uint32Array;
    const HEAPF32: Float32Array;
    const HEAPF64: Float64Array;
    class BaseVehicle {
        initialize(): boolean;
        destroyState(): void;
        initComponentSequence(addPhysXBeginEndComponents: boolean): void;
        step(dt: number, context: PxVehicleSimulationContext): void;
        baseParams: BaseVehicleParams;
        get_baseParams(): BaseVehicleParams;
        set_baseParams(value: BaseVehicleParams): void;
        baseState: BaseVehicleState;
        get_baseState(): BaseVehicleState;
        set_baseState(value: BaseVehicleState): void;
        componentSequence: PxVehicleComponentSequence;
        get_componentSequence(): PxVehicleComponentSequence;
        set_componentSequence(value: PxVehicleComponentSequence): void;
        componentSequenceSubstepGroupHandle: number;
        get_componentSequenceSubstepGroupHandle(): number;
        set_componentSequenceSubstepGroupHandle(value: number): void;
    }
    class BaseVehicleParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): BaseVehicleParams;
        isValid(): boolean;
        axleDescription: PxVehicleAxleDescription;
        get_axleDescription(): PxVehicleAxleDescription;
        set_axleDescription(value: PxVehicleAxleDescription): void;
        frame: PxVehicleFrame;
        get_frame(): PxVehicleFrame;
        set_frame(value: PxVehicleFrame): void;
        scale: PxVehicleScale;
        get_scale(): PxVehicleScale;
        set_scale(value: PxVehicleScale): void;
        suspensionStateCalculationParams: PxVehicleSuspensionStateCalculationParams;
        get_suspensionStateCalculationParams(): PxVehicleSuspensionStateCalculationParams;
        set_suspensionStateCalculationParams(value: PxVehicleSuspensionStateCalculationParams): void;
        brakeResponseParams: ReadonlyArray<PxVehicleBrakeCommandResponseParams>;
        get_brakeResponseParams(): ReadonlyArray<PxVehicleBrakeCommandResponseParams>;
        set_brakeResponseParams(value: ReadonlyArray<PxVehicleBrakeCommandResponseParams>): void;
        steerResponseParams: PxVehicleSteerCommandResponseParams;
        get_steerResponseParams(): PxVehicleSteerCommandResponseParams;
        set_steerResponseParams(value: PxVehicleSteerCommandResponseParams): void;
        ackermannParams: ReadonlyArray<PxVehicleAckermannParams>;
        get_ackermannParams(): ReadonlyArray<PxVehicleAckermannParams>;
        set_ackermannParams(value: ReadonlyArray<PxVehicleAckermannParams>): void;
        suspensionParams: ReadonlyArray<PxVehicleSuspensionParams>;
        get_suspensionParams(): ReadonlyArray<PxVehicleSuspensionParams>;
        set_suspensionParams(value: ReadonlyArray<PxVehicleSuspensionParams>): void;
        suspensionComplianceParams: ReadonlyArray<PxVehicleSuspensionComplianceParams>;
        get_suspensionComplianceParams(): ReadonlyArray<PxVehicleSuspensionComplianceParams>;
        set_suspensionComplianceParams(value: ReadonlyArray<PxVehicleSuspensionComplianceParams>): void;
        suspensionForceParams: ReadonlyArray<PxVehicleSuspensionForceParams>;
        get_suspensionForceParams(): ReadonlyArray<PxVehicleSuspensionForceParams>;
        set_suspensionForceParams(value: ReadonlyArray<PxVehicleSuspensionForceParams>): void;
        antiRollForceParams: ReadonlyArray<PxVehicleAntiRollForceParams>;
        get_antiRollForceParams(): ReadonlyArray<PxVehicleAntiRollForceParams>;
        set_antiRollForceParams(value: ReadonlyArray<PxVehicleAntiRollForceParams>): void;
        nbAntiRollForceParams: number;
        get_nbAntiRollForceParams(): number;
        set_nbAntiRollForceParams(value: number): void;
        tireForceParams: ReadonlyArray<PxVehicleTireForceParams>;
        get_tireForceParams(): ReadonlyArray<PxVehicleTireForceParams>;
        set_tireForceParams(value: ReadonlyArray<PxVehicleTireForceParams>): void;
        wheelParams: ReadonlyArray<PxVehicleWheelParams>;
        get_wheelParams(): ReadonlyArray<PxVehicleWheelParams>;
        set_wheelParams(value: ReadonlyArray<PxVehicleWheelParams>): void;
        rigidBodyParams: PxVehicleRigidBodyParams;
        get_rigidBodyParams(): PxVehicleRigidBodyParams;
        set_rigidBodyParams(value: PxVehicleRigidBodyParams): void;
    }
    class BaseVehicleState {
        constructor();
        setToDefault(): void;
        brakeCommandResponseStates: ReadonlyArray<number>;
        get_brakeCommandResponseStates(): ReadonlyArray<number>;
        set_brakeCommandResponseStates(value: ReadonlyArray<number>): void;
        steerCommandResponseStates: ReadonlyArray<number>;
        get_steerCommandResponseStates(): ReadonlyArray<number>;
        set_steerCommandResponseStates(value: ReadonlyArray<number>): void;
        actuationStates: ReadonlyArray<PxVehicleWheelActuationState>;
        get_actuationStates(): ReadonlyArray<PxVehicleWheelActuationState>;
        set_actuationStates(value: ReadonlyArray<PxVehicleWheelActuationState>): void;
        roadGeomStates: ReadonlyArray<PxVehicleRoadGeometryState>;
        get_roadGeomStates(): ReadonlyArray<PxVehicleRoadGeometryState>;
        set_roadGeomStates(value: ReadonlyArray<PxVehicleRoadGeometryState>): void;
        suspensionStates: ReadonlyArray<PxVehicleSuspensionState>;
        get_suspensionStates(): ReadonlyArray<PxVehicleSuspensionState>;
        set_suspensionStates(value: ReadonlyArray<PxVehicleSuspensionState>): void;
        suspensionComplianceStates: ReadonlyArray<PxVehicleSuspensionComplianceState>;
        get_suspensionComplianceStates(): ReadonlyArray<PxVehicleSuspensionComplianceState>;
        set_suspensionComplianceStates(value: ReadonlyArray<PxVehicleSuspensionComplianceState>): void;
        suspensionForces: ReadonlyArray<PxVehicleSuspensionForce>;
        get_suspensionForces(): ReadonlyArray<PxVehicleSuspensionForce>;
        set_suspensionForces(value: ReadonlyArray<PxVehicleSuspensionForce>): void;
        antiRollTorque: PxVehicleAntiRollTorque;
        get_antiRollTorque(): PxVehicleAntiRollTorque;
        set_antiRollTorque(value: PxVehicleAntiRollTorque): void;
        tireGripStates: ReadonlyArray<PxVehicleTireGripState>;
        get_tireGripStates(): ReadonlyArray<PxVehicleTireGripState>;
        set_tireGripStates(value: ReadonlyArray<PxVehicleTireGripState>): void;
        tireDirectionStates: ReadonlyArray<PxVehicleTireDirectionState>;
        get_tireDirectionStates(): ReadonlyArray<PxVehicleTireDirectionState>;
        set_tireDirectionStates(value: ReadonlyArray<PxVehicleTireDirectionState>): void;
        tireSpeedStates: ReadonlyArray<PxVehicleTireSpeedState>;
        get_tireSpeedStates(): ReadonlyArray<PxVehicleTireSpeedState>;
        set_tireSpeedStates(value: ReadonlyArray<PxVehicleTireSpeedState>): void;
        tireSlipStates: ReadonlyArray<PxVehicleTireSlipState>;
        get_tireSlipStates(): ReadonlyArray<PxVehicleTireSlipState>;
        set_tireSlipStates(value: ReadonlyArray<PxVehicleTireSlipState>): void;
        tireCamberAngleStates: ReadonlyArray<PxVehicleTireCamberAngleState>;
        get_tireCamberAngleStates(): ReadonlyArray<PxVehicleTireCamberAngleState>;
        set_tireCamberAngleStates(value: ReadonlyArray<PxVehicleTireCamberAngleState>): void;
        tireStickyStates: ReadonlyArray<PxVehicleTireStickyState>;
        get_tireStickyStates(): ReadonlyArray<PxVehicleTireStickyState>;
        set_tireStickyStates(value: ReadonlyArray<PxVehicleTireStickyState>): void;
        tireForces: ReadonlyArray<PxVehicleTireForce>;
        get_tireForces(): ReadonlyArray<PxVehicleTireForce>;
        set_tireForces(value: ReadonlyArray<PxVehicleTireForce>): void;
        wheelRigidBody1dStates: ReadonlyArray<PxVehicleWheelRigidBody1dState>;
        get_wheelRigidBody1dStates(): ReadonlyArray<PxVehicleWheelRigidBody1dState>;
        set_wheelRigidBody1dStates(value: ReadonlyArray<PxVehicleWheelRigidBody1dState>): void;
        wheelLocalPoses: ReadonlyArray<PxVehicleWheelLocalPose>;
        get_wheelLocalPoses(): ReadonlyArray<PxVehicleWheelLocalPose>;
        set_wheelLocalPoses(value: ReadonlyArray<PxVehicleWheelLocalPose>): void;
        rigidBodyState: PxVehicleRigidBodyState;
        get_rigidBodyState(): PxVehicleRigidBodyState;
        set_rigidBodyState(value: PxVehicleRigidBodyState): void;
    }
    class BoxSupport extends Support {
        constructor(halfExtents: PxVec3, margin?: number);
        halfExtents: PxVec3;
        get_halfExtents(): PxVec3;
        set_halfExtents(value: PxVec3): void;
        margin: number;
        get_margin(): number;
        set_margin(value: number): void;
    }
    class CapsuleSupport extends Support {
        constructor(radius: number, halfHeight: number);
        radius: number;
        get_radius(): number;
        set_radius(value: number): void;
        halfHeight: number;
        get_halfHeight(): number;
        set_halfHeight(value: number): void;
    }
    class ConvexGeomSupport extends Support {
        constructor();
        constructor(geom: PxGeometry, margin?: number);
    }
    class ConvexMeshSupport extends Support {
        constructor(convexMesh: PxConvexMesh, scale?: PxVec3, scaleRotation?: PxQuat, margin?: number);
        scale: PxVec3;
        get_scale(): PxVec3;
        set_scale(value: PxVec3): void;
        scaleRotation: PxQuat;
        get_scaleRotation(): PxQuat;
        set_scaleRotation(value: PxQuat): void;
        margin: number;
        get_margin(): number;
        set_margin(value: number): void;
    }
    class CustomSupport extends Support {
        getCustomMargin(): number;
        getCustomSupportLocal(dir: PxVec3, result: PxVec3): void;
    }
    class CustomSupportImpl {
        constructor();
        getCustomMargin(): number;
        getCustomSupportLocal(dir: PxVec3, result: PxVec3): void;
    }
    class DirectDriveVehicle extends PhysXActorVehicle {
        constructor();
        initialize(physics: PxPhysics, params: PxCookingParams, defaultMaterial: PxMaterial, addPhysXBeginEndComponents?: boolean): boolean;
        initComponentSequence(addPhysXBeginEndComponents: boolean): void;
        directDriveParams: DirectDrivetrainParams;
        get_directDriveParams(): DirectDrivetrainParams;
        set_directDriveParams(value: DirectDrivetrainParams): void;
        directDriveState: DirectDrivetrainState;
        get_directDriveState(): DirectDrivetrainState;
        set_directDriveState(value: DirectDrivetrainState): void;
        transmissionCommandState: PxVehicleDirectDriveTransmissionCommandState;
        get_transmissionCommandState(): PxVehicleDirectDriveTransmissionCommandState;
        set_transmissionCommandState(value: PxVehicleDirectDriveTransmissionCommandState): void;
    }
    class DirectDrivetrainParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): DirectDrivetrainParams;
        isValid(axleDesc: PxVehicleAxleDescription): boolean;
        directDriveThrottleResponseParams: PxVehicleDirectDriveThrottleCommandResponseParams;
        get_directDriveThrottleResponseParams(): PxVehicleDirectDriveThrottleCommandResponseParams;
        set_directDriveThrottleResponseParams(value: PxVehicleDirectDriveThrottleCommandResponseParams): void;
    }
    class DirectDrivetrainState {
        constructor();
        setToDefault(): void;
        directDriveThrottleResponseStates: ReadonlyArray<number>;
        get_directDriveThrottleResponseStates(): ReadonlyArray<number>;
        set_directDriveThrottleResponseStates(value: ReadonlyArray<number>): void;
    }
    class EngineDriveVehicle extends PhysXActorVehicle {
        constructor();
        initialize(physics: PxPhysics, params: PxCookingParams, defaultMaterial: PxMaterial, differentialType: EngineDriveVehicleEnum, addPhysXBeginEndComponents?: boolean): boolean;
        initComponentSequence(addPhysXBeginEndComponents: boolean): void;
        engineDriveParams: EngineDrivetrainParams;
        get_engineDriveParams(): EngineDrivetrainParams;
        set_engineDriveParams(value: EngineDrivetrainParams): void;
        engineDriveState: EngineDrivetrainState;
        get_engineDriveState(): EngineDrivetrainState;
        set_engineDriveState(value: EngineDrivetrainState): void;
        transmissionCommandState: PxVehicleEngineDriveTransmissionCommandState;
        get_transmissionCommandState(): PxVehicleEngineDriveTransmissionCommandState;
        set_transmissionCommandState(value: PxVehicleEngineDriveTransmissionCommandState): void;
        tankDriveTransmissionCommandState: PxVehicleTankDriveTransmissionCommandState;
        get_tankDriveTransmissionCommandState(): PxVehicleTankDriveTransmissionCommandState;
        set_tankDriveTransmissionCommandState(value: PxVehicleTankDriveTransmissionCommandState): void;
        differentialType: EngineDriveVehicleEnum;
        get_differentialType(): EngineDriveVehicleEnum;
        set_differentialType(value: EngineDriveVehicleEnum): void;
    }
    class EngineDrivetrainParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): EngineDrivetrainParams;
        isValid(axleDesc: PxVehicleAxleDescription): boolean;
        autoboxParams: PxVehicleAutoboxParams;
        get_autoboxParams(): PxVehicleAutoboxParams;
        set_autoboxParams(value: PxVehicleAutoboxParams): void;
        clutchCommandResponseParams: PxVehicleClutchCommandResponseParams;
        get_clutchCommandResponseParams(): PxVehicleClutchCommandResponseParams;
        set_clutchCommandResponseParams(value: PxVehicleClutchCommandResponseParams): void;
        engineParams: PxVehicleEngineParams;
        get_engineParams(): PxVehicleEngineParams;
        set_engineParams(value: PxVehicleEngineParams): void;
        gearBoxParams: PxVehicleGearboxParams;
        get_gearBoxParams(): PxVehicleGearboxParams;
        set_gearBoxParams(value: PxVehicleGearboxParams): void;
        multiWheelDifferentialParams: PxVehicleMultiWheelDriveDifferentialParams;
        get_multiWheelDifferentialParams(): PxVehicleMultiWheelDriveDifferentialParams;
        set_multiWheelDifferentialParams(value: PxVehicleMultiWheelDriveDifferentialParams): void;
        fourWheelDifferentialParams: PxVehicleFourWheelDriveDifferentialParams;
        get_fourWheelDifferentialParams(): PxVehicleFourWheelDriveDifferentialParams;
        set_fourWheelDifferentialParams(value: PxVehicleFourWheelDriveDifferentialParams): void;
        tankDifferentialParams: PxVehicleTankDriveDifferentialParams;
        get_tankDifferentialParams(): PxVehicleTankDriveDifferentialParams;
        set_tankDifferentialParams(value: PxVehicleTankDriveDifferentialParams): void;
        clutchParams: PxVehicleClutchParams;
        get_clutchParams(): PxVehicleClutchParams;
        set_clutchParams(value: PxVehicleClutchParams): void;
    }
    class EngineDrivetrainState {
        constructor();
        setToDefault(): void;
        throttleCommandResponseState: PxVehicleEngineDriveThrottleCommandResponseState;
        get_throttleCommandResponseState(): PxVehicleEngineDriveThrottleCommandResponseState;
        set_throttleCommandResponseState(value: PxVehicleEngineDriveThrottleCommandResponseState): void;
        autoboxState: PxVehicleAutoboxState;
        get_autoboxState(): PxVehicleAutoboxState;
        set_autoboxState(value: PxVehicleAutoboxState): void;
        clutchCommandResponseState: PxVehicleClutchCommandResponseState;
        get_clutchCommandResponseState(): PxVehicleClutchCommandResponseState;
        set_clutchCommandResponseState(value: PxVehicleClutchCommandResponseState): void;
        differentialState: PxVehicleDifferentialState;
        get_differentialState(): PxVehicleDifferentialState;
        set_differentialState(value: PxVehicleDifferentialState): void;
        wheelConstraintGroupState: PxVehicleWheelConstraintGroupState;
        get_wheelConstraintGroupState(): PxVehicleWheelConstraintGroupState;
        set_wheelConstraintGroupState(value: PxVehicleWheelConstraintGroupState): void;
        engineState: PxVehicleEngineState;
        get_engineState(): PxVehicleEngineState;
        set_engineState(value: PxVehicleEngineState): void;
        gearboxState: PxVehicleGearboxState;
        get_gearboxState(): PxVehicleGearboxState;
        set_gearboxState(value: PxVehicleGearboxState): void;
        clutchState: PxVehicleClutchSlipState;
        get_clutchState(): PxVehicleClutchSlipState;
        set_clutchState(value: PxVehicleClutchSlipState): void;
    }
    class NativeArrayHelpers {
        getU8At(base: PxU8ConstPtr, index: number): number;
        getU16At(base: PxU16ConstPtr, index: number): number;
        getU32At(base: PxU32ConstPtr, index: number): number;
        getRealAt(base: PxRealPtr, index: number): number;
        setU8At(base: VoidPtr, index: number, value: number): void;
        setU16At(base: VoidPtr, index: number, value: number): void;
        setU32At(base: VoidPtr, index: number, value: number): void;
        setRealAt(base: VoidPtr, index: number, value: number): void;
        voidToU8Ptr(voidPtr: VoidPtr): PxU8Ptr;
        voidToU16Ptr(voidPtr: VoidPtr): PxU16Ptr;
        voidToU32Ptr(voidPtr: VoidPtr): PxU32Ptr;
        voidToI32Ptr(voidPtr: VoidPtr): PxI32Ptr;
        voidToRealPtr(voidPtr: VoidPtr): PxRealPtr;
        getActorAt(base: PxActor, index: number): PxActor;
        getBounds3At(base: PxBounds3, index: number): PxBounds3;
        getContactPairAt(base: PxContactPair, index: number): PxContactPair;
        getContactPairHeaderAt(base: PxContactPairHeader, index: number): PxContactPairHeader;
        getControllerAt(base: PxController, index: number): PxController;
        getControllerShapeHitAt(base: PxControllerShapeHit, index: number): PxControllerShapeHit;
        getControllersHitAt(base: PxControllersHit, index: number): PxControllersHit;
        getControllerObstacleHitAt(base: PxControllerObstacleHit, index: number): PxControllerObstacleHit;
        getDebugPointAt(base: PxDebugPoint, index: number): PxDebugPoint;
        getDebugLineAt(base: PxDebugLine, index: number): PxDebugLine;
        getDebugTriangleAt(base: PxDebugTriangle, index: number): PxDebugTriangle;
        getObstacleAt(base: PxObstacle, index: number): PxObstacle;
        getShapeAt(base: PxShape, index: number): PxShape;
        getTriggerPairAt(base: PxTriggerPair, index: number): PxTriggerPair;
        getVec3At(base: PxVec3, index: number): PxVec3;
    }
    class PassThroughFilterShader extends PxSimulationFilterShader {
        filterShader(attributes0: number, filterData0w0: number, filterData0w1: number, filterData0w2: number, filterData0w3: number, attributes1: number, filterData1w0: number, filterData1w1: number, filterData1w2: number, filterData1w3: number): number;
        outputPairFlags: number;
        get_outputPairFlags(): number;
        set_outputPairFlags(value: number): void;
    }
    class PassThroughFilterShaderImpl {
        constructor();
        filterShader(attributes0: number, filterData0w0: number, filterData0w1: number, filterData0w2: number, filterData0w3: number, attributes1: number, filterData1w0: number, filterData1w1: number, filterData1w2: number, filterData1w3: number): number;
    }
    class PhysXActorVehicle extends BaseVehicle {
        initialize(physics: PxPhysics, params: PxCookingParams, defaultMaterial: PxMaterial): boolean;
        physXParams: PhysXIntegrationParams;
        get_physXParams(): PhysXIntegrationParams;
        set_physXParams(value: PhysXIntegrationParams): void;
        physXState: PhysXIntegrationState;
        get_physXState(): PhysXIntegrationState;
        set_physXState(value: PhysXIntegrationState): void;
        commandState: PxVehicleCommandState;
        get_commandState(): PxVehicleCommandState;
        set_commandState(value: PxVehicleCommandState): void;
    }
    class PhysXIntegrationParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PhysXIntegrationParams;
        isValid(axleDesc: PxVehicleAxleDescription): boolean;
        create(axleDesc: PxVehicleAxleDescription, roadQueryFilterData: PxQueryFilterData, roadQueryFilterCallback: PxQueryFilterCallback, materialFrictions: PxVehiclePhysXMaterialFriction, nbMaterialFrictions: number, defaultFriction: number, physxActorCMassLocalPose: PxTransform, actorGeometry: PxGeometry, physxActorBoxShapeLocalPose: PxTransform, roadGeometryQueryType: PxVehiclePhysXRoadGeometryQueryTypeEnum): void;
        physxRoadGeometryQueryParams: PxVehiclePhysXRoadGeometryQueryParams;
        get_physxRoadGeometryQueryParams(): PxVehiclePhysXRoadGeometryQueryParams;
        set_physxRoadGeometryQueryParams(value: PxVehiclePhysXRoadGeometryQueryParams): void;
        physxMaterialFrictionParams: ReadonlyArray<PxVehiclePhysXMaterialFrictionParams>;
        get_physxMaterialFrictionParams(): ReadonlyArray<PxVehiclePhysXMaterialFrictionParams>;
        set_physxMaterialFrictionParams(value: ReadonlyArray<PxVehiclePhysXMaterialFrictionParams>): void;
        physxSuspensionLimitConstraintParams: ReadonlyArray<PxVehiclePhysXSuspensionLimitConstraintParams>;
        get_physxSuspensionLimitConstraintParams(): ReadonlyArray<PxVehiclePhysXSuspensionLimitConstraintParams>;
        set_physxSuspensionLimitConstraintParams(value: ReadonlyArray<PxVehiclePhysXSuspensionLimitConstraintParams>): void;
        physxActorCMassLocalPose: PxTransform;
        get_physxActorCMassLocalPose(): PxTransform;
        set_physxActorCMassLocalPose(value: PxTransform): void;
        physxActorGeometry: PxGeometry;
        get_physxActorGeometry(): PxGeometry;
        set_physxActorGeometry(value: PxGeometry): void;
        physxActorBoxShapeLocalPose: PxTransform;
        get_physxActorBoxShapeLocalPose(): PxTransform;
        set_physxActorBoxShapeLocalPose(value: PxTransform): void;
        physxWheelShapeLocalPoses: ReadonlyArray<PxTransform>;
        get_physxWheelShapeLocalPoses(): ReadonlyArray<PxTransform>;
        set_physxWheelShapeLocalPoses(value: ReadonlyArray<PxTransform>): void;
        physxActorShapeFlags: PxShapeFlags;
        get_physxActorShapeFlags(): PxShapeFlags;
        set_physxActorShapeFlags(value: PxShapeFlags): void;
        physxActorSimulationFilterData: PxFilterData;
        get_physxActorSimulationFilterData(): PxFilterData;
        set_physxActorSimulationFilterData(value: PxFilterData): void;
        physxActorQueryFilterData: PxFilterData;
        get_physxActorQueryFilterData(): PxFilterData;
        set_physxActorQueryFilterData(value: PxFilterData): void;
        physxActorWheelShapeFlags: PxShapeFlags;
        get_physxActorWheelShapeFlags(): PxShapeFlags;
        set_physxActorWheelShapeFlags(value: PxShapeFlags): void;
        physxActorWheelSimulationFilterData: PxFilterData;
        get_physxActorWheelSimulationFilterData(): PxFilterData;
        set_physxActorWheelSimulationFilterData(value: PxFilterData): void;
        physxActorWheelQueryFilterData: PxFilterData;
        get_physxActorWheelQueryFilterData(): PxFilterData;
        set_physxActorWheelQueryFilterData(value: PxFilterData): void;
    }
    class PhysXIntegrationState {
        constructor();
        destroyState(): void;
        setToDefault(): void;
        create(baseParams: BaseVehicleParams, physxParams: PhysXIntegrationParams, physics: PxPhysics, params: PxCookingParams, defaultMaterial: PxMaterial): void;
        physxActor: PxVehiclePhysXActor;
        get_physxActor(): PxVehiclePhysXActor;
        set_physxActor(value: PxVehiclePhysXActor): void;
        physxSteerState: PxVehiclePhysXSteerState;
        get_physxSteerState(): PxVehiclePhysXSteerState;
        set_physxSteerState(value: PxVehiclePhysXSteerState): void;
        physxConstraints: PxVehiclePhysXConstraints;
        get_physxConstraints(): PxVehiclePhysXConstraints;
        set_physxConstraints(value: PxVehiclePhysXConstraints): void;
    }
    class PxActor extends PxBase {
        getType(): PxActorTypeEnum;
        getScene(): PxScene;
        setName(name: string): void;
        getName(): string;
        getWorldBounds(inflation?: number): PxBounds3;
        setActorFlag(flag: PxActorFlagEnum, value: boolean): void;
        setActorFlags(flags: PxActorFlags): void;
        getActorFlags(): PxActorFlags;
        setDominanceGroup(dominanceGroup: number): void;
        getDominanceGroup(): number;
        setOwnerClient(inClient: number): void;
        getOwnerClient(): number;
        userData: VoidPtr;
        get_userData(): VoidPtr;
        set_userData(value: VoidPtr): void;
    }
    class PxActorFlags {
        constructor(flags: number);
        isSet(flag: PxActorFlagEnum): boolean;
        raise(flag: PxActorFlagEnum): void;
        clear(flag: PxActorFlagEnum): void;
    }
    class PxActorPtr {
    }
    class PxActorTypeFlags {
        constructor(flags: number);
        isSet(flag: PxActorTypeFlagEnum): boolean;
        raise(flag: PxActorTypeFlagEnum): void;
        clear(flag: PxActorTypeFlagEnum): void;
    }
    class PxAggregate extends PxBase {
        addActor(actor: PxActor, bvh?: PxBVH): boolean;
        removeActor(actor: PxActor): boolean;
        addArticulation(articulation: PxArticulationReducedCoordinate): boolean;
        removeArticulation(articulation: PxArticulationReducedCoordinate): boolean;
        getNbActors(): number;
        getMaxNbActors(): number;
        getMaxNbShapes(): number;
        getScene(): PxScene;
        getSelfCollision(): boolean;
    }
    class PxArray_PxActorPtr {
        constructor();
        constructor(size: number);
        get(index: number): PxActor;
        set(index: number, value: PxActorPtr): void;
        begin(): PxActorPtr;
        size(): number;
        pushBack(value: PxActor): void;
        clear(): void;
    }
    class PxArray_PxContactPairPoint {
        constructor();
        constructor(size: number);
        get(index: number): PxContactPairPoint;
        set(index: number, value: PxContactPairPoint): void;
        begin(): PxContactPairPoint;
        size(): number;
        pushBack(value: PxContactPairPoint): void;
        clear(): void;
    }
    class PxArray_PxHeightFieldSample {
        constructor();
        constructor(size: number);
        get(index: number): PxHeightFieldSample;
        set(index: number, value: PxHeightFieldSample): void;
        begin(): PxHeightFieldSample;
        size(): number;
        pushBack(value: PxHeightFieldSample): void;
        clear(): void;
    }
    class PxArray_PxMaterialConst {
        constructor();
        constructor(size: number);
        get(index: number): PxMaterial;
        set(index: number, value: PxMaterialConstPtr): void;
        begin(): PxMaterialConstPtr;
        size(): number;
        pushBack(value: PxMaterial): void;
        clear(): void;
    }
    class PxArray_PxRaycastHit {
        constructor();
        constructor(size: number);
        get(index: number): PxRaycastHit;
        set(index: number, value: PxRaycastHit): void;
        begin(): PxRaycastHit;
        size(): number;
        pushBack(value: PxRaycastHit): void;
        clear(): void;
    }
    class PxArray_PxReal {
        constructor();
        constructor(size: number);
        get(index: number): number;
        set(index: number, value: number): void;
        begin(): VoidPtr;
        size(): number;
        pushBack(value: number): void;
        clear(): void;
    }
    class PxArray_PxShapePtr {
        constructor();
        constructor(size: number);
        get(index: number): PxShape;
        set(index: number, value: PxShapePtr): void;
        begin(): PxShapePtr;
        size(): number;
        pushBack(value: PxShape): void;
        clear(): void;
    }
    class PxArray_PxSweepHit {
        constructor();
        constructor(size: number);
        get(index: number): PxSweepHit;
        set(index: number, value: PxSweepHit): void;
        begin(): PxSweepHit;
        size(): number;
        pushBack(value: PxSweepHit): void;
        clear(): void;
    }
    class PxArray_PxU16 {
        constructor();
        constructor(size: number);
        get(index: number): number;
        set(index: number, value: number): void;
        begin(): VoidPtr;
        size(): number;
        pushBack(value: number): void;
        clear(): void;
    }
    class PxArray_PxU32 {
        constructor();
        constructor(size: number);
        get(index: number): number;
        set(index: number, value: number): void;
        begin(): VoidPtr;
        size(): number;
        pushBack(value: number): void;
        clear(): void;
    }
    class PxArray_PxU8 {
        constructor();
        constructor(size: number);
        get(index: number): number;
        set(index: number, value: number): void;
        begin(): VoidPtr;
        size(): number;
        pushBack(value: number): void;
        setFromBuffer(buffer: VoidPtr, size: number): void;
        clear(): void;
    }
    class PxArray_PxVec3 {
        constructor();
        constructor(size: number);
        get(index: number): PxVec3;
        set(index: number, value: PxVec3): void;
        begin(): PxVec3;
        size(): number;
        pushBack(value: PxVec3): void;
        clear(): void;
    }
    class PxArray_PxVec4 {
        constructor();
        constructor(size: number);
        get(index: number): PxVec4;
        set(index: number, value: PxVec4): void;
        begin(): PxVec4;
        size(): number;
        pushBack(value: PxVec4): void;
        clear(): void;
    }
    class PxArticulationAttachment {
        setRestLength(restLength: number): void;
        getRestLength(): number;
        setLimitParameters(parameters: PxArticulationTendonLimit): void;
        getLimitParameters(): PxArticulationTendonLimit;
        setRelativeOffset(offset: PxVec3): void;
        getRelativeOffset(): PxVec3;
        setCoefficient(coefficient: number): void;
        getCoefficient(): number;
        getLink(): PxArticulationLink;
        getParent(): PxArticulationAttachment;
        isLeaf(): boolean;
        getTendon(): PxArticulationSpatialTendon;
        release(): void;
        userData: VoidPtr;
        get_userData(): VoidPtr;
        set_userData(value: VoidPtr): void;
    }
    class PxArticulationCache {
        release(): void;
        externalForces: PxSpatialForce;
        get_externalForces(): PxSpatialForce;
        set_externalForces(value: PxSpatialForce): void;
        denseJacobian: PxRealPtr;
        get_denseJacobian(): PxRealPtr;
        set_denseJacobian(value: PxRealPtr): void;
        massMatrix: PxRealPtr;
        get_massMatrix(): PxRealPtr;
        set_massMatrix(value: PxRealPtr): void;
        jointVelocity: PxRealPtr;
        get_jointVelocity(): PxRealPtr;
        set_jointVelocity(value: PxRealPtr): void;
        jointAcceleration: PxRealPtr;
        get_jointAcceleration(): PxRealPtr;
        set_jointAcceleration(value: PxRealPtr): void;
        jointPosition: PxRealPtr;
        get_jointPosition(): PxRealPtr;
        set_jointPosition(value: PxRealPtr): void;
        jointForce: PxRealPtr;
        get_jointForce(): PxRealPtr;
        set_jointForce(value: PxRealPtr): void;
        linkVelocity: PxSpatialVelocity;
        get_linkVelocity(): PxSpatialVelocity;
        set_linkVelocity(value: PxSpatialVelocity): void;
        linkAcceleration: PxSpatialVelocity;
        get_linkAcceleration(): PxSpatialVelocity;
        set_linkAcceleration(value: PxSpatialVelocity): void;
        linkIncomingJointForce: PxSpatialForce;
        get_linkIncomingJointForce(): PxSpatialForce;
        set_linkIncomingJointForce(value: PxSpatialForce): void;
        rootLinkData: PxArticulationRootLinkData;
        get_rootLinkData(): PxArticulationRootLinkData;
        set_rootLinkData(value: PxArticulationRootLinkData): void;
        coefficientMatrix: PxRealPtr;
        get_coefficientMatrix(): PxRealPtr;
        set_coefficientMatrix(value: PxRealPtr): void;
        lambda: PxRealPtr;
        get_lambda(): PxRealPtr;
        set_lambda(value: PxRealPtr): void;
        scratchMemory: VoidPtr;
        get_scratchMemory(): VoidPtr;
        set_scratchMemory(value: VoidPtr): void;
        scratchAllocator: VoidPtr;
        get_scratchAllocator(): VoidPtr;
        set_scratchAllocator(value: VoidPtr): void;
        version: number;
        get_version(): number;
        set_version(value: number): void;
    }
    class PxArticulationCacheFlags {
        constructor(flags: number);
        isSet(flag: PxArticulationCacheFlagEnum): boolean;
        raise(flag: PxArticulationCacheFlagEnum): void;
        clear(flag: PxArticulationCacheFlagEnum): void;
    }
    class PxArticulationDrive {
        constructor();
        constructor(stiffness: number, damping: number, maxForce: number, driveType: PxArticulationDriveTypeEnum);
        stiffness: number;
        get_stiffness(): number;
        set_stiffness(value: number): void;
        damping: number;
        get_damping(): number;
        set_damping(value: number): void;
        maxForce: number;
        get_maxForce(): number;
        set_maxForce(value: number): void;
        driveType: PxArticulationDriveTypeEnum;
        get_driveType(): PxArticulationDriveTypeEnum;
        set_driveType(value: PxArticulationDriveTypeEnum): void;
    }
    class PxArticulationFixedTendon extends PxArticulationTendon {
        createTendonJoint(parent: PxArticulationTendonJoint, axis: PxArticulationAxisEnum, coefficient: number, recipCoefficient: number, link: PxArticulationLink): PxArticulationTendonJoint;
        getNbTendonJoints(): number;
        setRestLength(restLength: number): void;
        getRestLength(): number;
        setLimitParameters(parameter: PxArticulationTendonLimit): void;
        getLimitParameters(): PxArticulationTendonLimit;
    }
    class PxArticulationFlags {
        constructor(flags: number);
        isSet(flag: PxArticulationFlagEnum): boolean;
        raise(flag: PxArticulationFlagEnum): void;
        clear(flag: PxArticulationFlagEnum): void;
    }
    class PxArticulationJointReducedCoordinate extends PxBase {
        getParentArticulationLink(): PxArticulationLink;
        setParentPose(pose: PxTransform): void;
        getParentPose(): PxTransform;
        getChildArticulationLink(): PxArticulationLink;
        setChildPose(pose: PxTransform): void;
        getChildPose(): PxTransform;
        setJointType(jointType: PxArticulationJointTypeEnum): void;
        getJointType(): PxArticulationJointTypeEnum;
        setMotion(axis: PxArticulationAxisEnum, motion: PxArticulationMotionEnum): void;
        getMotion(axis: PxArticulationAxisEnum): PxArticulationMotionEnum;
        setLimitParams(axis: PxArticulationAxisEnum, limit: PxArticulationLimit): void;
        getLimitParams(axis: PxArticulationAxisEnum): PxArticulationLimit;
        setDriveParams(axis: PxArticulationAxisEnum, drive: PxArticulationDrive): void;
        setDriveTarget(axis: PxArticulationAxisEnum, target: number, autowake?: boolean): void;
        getDriveTarget(axis: PxArticulationAxisEnum): number;
        setDriveVelocity(axis: PxArticulationAxisEnum, targetVel: number, autowake?: boolean): void;
        getDriveVelocity(axis: PxArticulationAxisEnum): number;
        setArmature(axis: PxArticulationAxisEnum, armature: number): void;
        getArmature(axis: PxArticulationAxisEnum): number;
        setFrictionCoefficient(coefficient: number): void;
        getFrictionCoefficient(): number;
        setMaxJointVelocity(maxJointV: number): void;
        getMaxJointVelocity(): number;
        setJointPosition(axis: PxArticulationAxisEnum, jointPos: number): void;
        getJointPosition(axis: PxArticulationAxisEnum): number;
        setJointVelocity(axis: PxArticulationAxisEnum, jointVel: number): void;
        getJointVelocity(axis: PxArticulationAxisEnum): number;
    }
    class PxArticulationKinematicFlags {
        constructor(flags: number);
        isSet(flag: PxArticulationKinematicFlagEnum): boolean;
        raise(flag: PxArticulationKinematicFlagEnum): void;
        clear(flag: PxArticulationKinematicFlagEnum): void;
    }
    class PxArticulationLimit {
        constructor();
        constructor(low: number, high: number);
        low: number;
        get_low(): number;
        set_low(value: number): void;
        high: number;
        get_high(): number;
        set_high(value: number): void;
    }
    class PxArticulationLink extends PxRigidBody {
        getArticulation(): PxArticulationReducedCoordinate;
        getInboundJoint(): PxArticulationJointReducedCoordinate;
        getInboundJointDof(): number;
        getNbChildren(): number;
        getLinkIndex(): number;
        setCfmScale(cfm: number): void;
        getCfmScale(): number;
    }
    class PxArticulationReducedCoordinate extends PxBase {
        getScene(): PxScene;
        setSolverIterationCounts(minPositionIters: number, minVelocityIters?: number): void;
        isSleeping(): boolean;
        setSleepThreshold(threshold: number): void;
        getSleepThreshold(): number;
        setStabilizationThreshold(threshold: number): void;
        getStabilizationThreshold(): number;
        setWakeCounter(wakeCounterValue: number): void;
        getWakeCounter(): number;
        wakeUp(): void;
        putToSleep(): void;
        createLink(parent: PxArticulationLink, pose: PxTransform): PxArticulationLink;
        getNbLinks(): number;
        getNbShapes(): number;
        setName(name: string): void;
        getName(): string;
        getWorldBounds(inflation?: number): PxBounds3;
        getAggregate(): PxAggregate;
        setArticulationFlags(flags: PxArticulationFlags): void;
        setArticulationFlag(flag: PxArticulationFlagEnum, value: boolean): void;
        getArticulationFlags(): PxArticulationFlags;
        getDofs(): number;
        createCache(): PxArticulationCache;
        getCacheDataSize(): number;
        zeroCache(cache: PxArticulationCache): void;
        applyCache(cache: PxArticulationCache, flags: PxArticulationCacheFlags, autowake?: boolean): void;
        copyInternalStateToCache(cache: PxArticulationCache, flags: PxArticulationCacheFlags): void;
        commonInit(): void;
        computeGravityCompensation(cache: PxArticulationCache): void;
        computeCoriolisCompensation(cache: PxArticulationCache): void;
        computeGeneralizedExternalForce(cache: PxArticulationCache): void;
        computeJointAcceleration(cache: PxArticulationCache): void;
        computeJointForce(cache: PxArticulationCache): void;
        computeCoefficientMatrix(cache: PxArticulationCache): void;
        computeMassMatrix(cache: PxArticulationCache): void;
        computeArticulationCOM(rootFrame: boolean): PxVec3;
        computeCentroidalMomentumMatrix(cache: PxArticulationCache): void;
        addLoopJoint(joint: PxConstraint): void;
        removeLoopJoint(joint: PxConstraint): void;
        getNbLoopJoints(): number;
        getCoefficientMatrixSize(): number;
        setRootGlobalPose(pose: PxTransform, autowake?: boolean): void;
        getRootGlobalPose(): PxTransform;
        setRootLinearVelocity(linearVelocity: PxVec3, autowake?: boolean): void;
        getRootLinearVelocity(): PxVec3;
        setRootAngularVelocity(angularVelocity: PxVec3, autowake?: boolean): void;
        getRootAngularVelocity(): PxVec3;
        getLinkAcceleration(linkId: number): PxSpatialVelocity;
        getGPUIndex(): number;
        createSpatialTendon(): PxArticulationSpatialTendon;
        createFixedTendon(): PxArticulationFixedTendon;
        getNbSpatialTendons(): number;
        getNbFixedTendons(): number;
        updateKinematic(flags: PxArticulationKinematicFlags): void;
    }
    class PxArticulationRootLinkData {
        constructor();
        transform: PxTransform;
        get_transform(): PxTransform;
        set_transform(value: PxTransform): void;
        worldLinVel: PxVec3;
        get_worldLinVel(): PxVec3;
        set_worldLinVel(value: PxVec3): void;
        worldAngVel: PxVec3;
        get_worldAngVel(): PxVec3;
        set_worldAngVel(value: PxVec3): void;
        worldLinAccel: PxVec3;
        get_worldLinAccel(): PxVec3;
        set_worldLinAccel(value: PxVec3): void;
        worldAngAccel: PxVec3;
        get_worldAngAccel(): PxVec3;
        set_worldAngAccel(value: PxVec3): void;
    }
    class PxArticulationSpatialTendon extends PxArticulationTendon {
        createAttachment(parent: PxArticulationAttachment, coefficient: number, relativeOffset: PxVec3, link: PxArticulationLink): PxArticulationAttachment;
        getNbAttachments(): number;
    }
    class PxArticulationTendon extends PxBase {
        setStiffness(stiffness: number): void;
        getStiffness(): number;
        setDamping(damping: number): void;
        getDamping(): number;
        setLimitStiffness(stiffness: number): void;
        getLimitStiffness(): number;
        setOffset(offset: number, autowake?: boolean): void;
        getOffset(): number;
        getArticulation(): PxArticulationReducedCoordinate;
    }
    class PxArticulationTendonJoint {
        setCoefficient(axis: PxArticulationAxisEnum, coefficient: number, recipCoefficient: number): void;
        getLink(): PxArticulationLink;
        getParent(): PxArticulationTendonJoint;
        getTendon(): PxArticulationFixedTendon;
        release(): void;
        userData: VoidPtr;
        get_userData(): VoidPtr;
        set_userData(value: VoidPtr): void;
    }
    class PxArticulationTendonLimit {
        lowLimit: number;
        get_lowLimit(): number;
        set_lowLimit(value: number): void;
        highLimit: number;
        get_highLimit(): number;
        set_highLimit(value: number): void;
    }
    class PxBVH extends PxBase {
    }
    class PxBVH33MidphaseDesc {
        setToDefault(): void;
        isValid(): boolean;
        meshSizePerformanceTradeOff: number;
        get_meshSizePerformanceTradeOff(): number;
        set_meshSizePerformanceTradeOff(value: number): void;
        meshCookingHint: PxMeshCookingHintEnum;
        get_meshCookingHint(): PxMeshCookingHintEnum;
        set_meshCookingHint(value: PxMeshCookingHintEnum): void;
    }
    class PxBVH34MidphaseDesc {
        setToDefault(): void;
        isValid(): boolean;
        numPrimsPerLeaf: number;
        get_numPrimsPerLeaf(): number;
        set_numPrimsPerLeaf(value: number): void;
    }
    class PxBase {
        release(): void;
        getConcreteTypeName(): string;
        getConcreteType(): number;
        setBaseFlag(flag: PxBaseFlagEnum, value: boolean): void;
        setBaseFlags(inFlags: PxBaseFlags): void;
        getBaseFlags(): PxBaseFlags;
        isReleasable(): boolean;
    }
    class PxBaseFlags {
        constructor(flags: number);
        isSet(flag: PxBaseFlagEnum): boolean;
        raise(flag: PxBaseFlagEnum): void;
        clear(flag: PxBaseFlagEnum): void;
    }
    class PxBaseMaterial extends PxRefCounted {
    }
    class PxBaseTask {
    }
    class PxBoundedData extends PxStridedData {
        constructor();
        count: number;
        get_count(): number;
        set_count(value: number): void;
    }
    class PxBounds3 {
        constructor();
        constructor(minimum: PxVec3, maximum: PxVec3);
        setEmpty(): void;
        setMaximal(): void;
        include(v: PxVec3): void;
        isEmpty(): boolean;
        intersects(b: PxBounds3): boolean;
        intersects1D(b: PxBounds3, axis: number): boolean;
        contains(v: PxVec3): boolean;
        isInside(box: PxBounds3): boolean;
        getCenter(): PxVec3;
        getDimensions(): PxVec3;
        getExtents(): PxVec3;
        scaleSafe(scale: number): void;
        scaleFast(scale: number): void;
        fattenSafe(distance: number): void;
        fattenFast(distance: number): void;
        isFinite(): boolean;
        isValid(): boolean;
        minimum: PxVec3;
        get_minimum(): PxVec3;
        set_minimum(value: PxVec3): void;
        maximum: PxVec3;
        get_maximum(): PxVec3;
        set_maximum(value: PxVec3): void;
    }
    class PxBoxController extends PxController {
        getHalfHeight(): number;
        getHalfSideExtent(): number;
        getHalfForwardExtent(): number;
        setHalfHeight(halfHeight: number): boolean;
        setHalfSideExtent(halfSideExtent: number): boolean;
        setHalfForwardExtent(halfForwardExtent: number): boolean;
    }
    class PxBoxControllerDesc extends PxControllerDesc {
        constructor();
        setToDefault(): void;
        halfHeight: number;
        get_halfHeight(): number;
        set_halfHeight(value: number): void;
        halfSideExtent: number;
        get_halfSideExtent(): number;
        set_halfSideExtent(value: number): void;
        halfForwardExtent: number;
        get_halfForwardExtent(): number;
        set_halfForwardExtent(value: number): void;
    }
    class PxBoxGeometry extends PxGeometry {
        constructor(hx: number, hy: number, hz: number);
        halfExtents: PxVec3;
        get_halfExtents(): PxVec3;
        set_halfExtents(value: PxVec3): void;
    }
    class PxBoxObstacle extends PxObstacle {
        constructor();
        mHalfExtents: PxVec3;
        get_mHalfExtents(): PxVec3;
        set_mHalfExtents(value: PxVec3): void;
    }
    class PxBroadPhaseCaps {
        constructor();
        mMaxNbRegions: number;
        get_mMaxNbRegions(): number;
        set_mMaxNbRegions(value: number): void;
    }
    class PxBroadPhaseRegion {
        constructor();
        mBounds: PxBounds3;
        get_mBounds(): PxBounds3;
        set_mBounds(value: PxBounds3): void;
        mUserData: VoidPtr;
        get_mUserData(): VoidPtr;
        set_mUserData(value: VoidPtr): void;
    }
    class PxBroadPhaseRegionInfo {
        constructor();
        mRegion: PxBroadPhaseRegion;
        get_mRegion(): PxBroadPhaseRegion;
        set_mRegion(value: PxBroadPhaseRegion): void;
        mNbStaticObjects: number;
        get_mNbStaticObjects(): number;
        set_mNbStaticObjects(value: number): void;
        mNbDynamicObjects: number;
        get_mNbDynamicObjects(): number;
        set_mNbDynamicObjects(value: number): void;
        mActive: boolean;
        get_mActive(): boolean;
        set_mActive(value: boolean): void;
        mOverlap: boolean;
        get_mOverlap(): boolean;
        set_mOverlap(value: boolean): void;
    }
    class PxCapsuleController extends PxController {
        getRadius(): number;
        setRadius(radius: number): boolean;
        getHeight(): number;
        setHeight(height: number): boolean;
        getClimbingMode(): PxCapsuleClimbingModeEnum;
        setClimbingMode(mode: PxCapsuleClimbingModeEnum): boolean;
    }
    class PxCapsuleControllerDesc extends PxControllerDesc {
        constructor();
        setToDefault(): void;
        radius: number;
        get_radius(): number;
        set_radius(value: number): void;
        height: number;
        get_height(): number;
        set_height(value: number): void;
        climbingMode: PxCapsuleClimbingModeEnum;
        get_climbingMode(): PxCapsuleClimbingModeEnum;
        set_climbingMode(value: PxCapsuleClimbingModeEnum): void;
    }
    class PxCapsuleGeometry extends PxGeometry {
        constructor(radius: number, halfHeight: number);
        radius: number;
        get_radius(): number;
        set_radius(value: number): void;
        halfHeight: number;
        get_halfHeight(): number;
        set_halfHeight(value: number): void;
    }
    class PxCapsuleObstacle extends PxObstacle {
        constructor();
        mHalfHeight: number;
        get_mHalfHeight(): number;
        set_mHalfHeight(value: number): void;
        mRadius: number;
        get_mRadius(): number;
        set_mRadius(value: number): void;
    }
    class PxCollection {
        add(obj: PxBase, id?: number): void;
        remove(obj: PxBase): void;
        contains(obj: PxBase): boolean;
        addId(obj: PxBase, id: number): void;
        removeId(id: number): void;
        getNbObjects(): number;
        getObject(index: number): PxBase;
        find(id: number): PxBase;
        getNbIds(): number;
        getId(obj: PxBase): number;
        release(): void;
    }
    class PxCollectionExt {
        static releaseObjects(collection: PxCollection, releaseExclusiveShapes?: boolean): void;
        static remove(collection: PxCollection, concreteType: number, to?: PxCollection): void;
        static createCollection(scene: PxScene): PxCollection;
    }
    class PxConstraint extends PxBase {
        getScene(): PxScene;
        setActors(actor0: PxRigidActor, actor1: PxRigidActor): void;
        markDirty(): void;
        setFlags(flags: PxConstraintFlags): void;
        getFlags(): PxConstraintFlags;
        setFlag(flag: PxConstraintFlagEnum, value: boolean): void;
        getForce(linear: PxVec3, angular: PxVec3): void;
        isValid(): boolean;
        setBreakForce(linear: number, angular: number): void;
        setMinResponseThreshold(threshold: number): void;
        getMinResponseThreshold(): number;
    }
    class PxConstraintConnector {
        prepareData(): void;
        updateOmniPvdProperties(): void;
        onConstraintRelease(): void;
        onComShift(actor: number): void;
        onOriginShift(shift: PxVec3): void;
        getSerializable(): PxBase;
        getPrep(): PxConstraintSolverPrep;
        getConstantBlock(): void;
        connectToConstraint(constraint: PxConstraint): void;
    }
    class PxConstraintFlags {
        constructor(flags: number);
        isSet(flag: PxConstraintFlagEnum): boolean;
        raise(flag: PxConstraintFlagEnum): void;
        clear(flag: PxConstraintFlagEnum): void;
    }
    class PxConstraintInfo {
        constraint: PxConstraint;
        get_constraint(): PxConstraint;
        set_constraint(value: PxConstraint): void;
        externalReference: VoidPtr;
        get_externalReference(): VoidPtr;
        set_externalReference(value: VoidPtr): void;
        type: number;
        get_type(): number;
        set_type(value: number): void;
    }
    class PxConstraintSolverPrep {
    }
    class PxContactBuffer {
        reset(): void;
        contact(worldPoint: PxVec3, worldNormalIn: PxVec3, separation: number, faceIndex1?: number): boolean;
        contact(pt: PxContactPoint): boolean;
        contacts: ReadonlyArray<PxContactPoint>;
        get_contacts(): ReadonlyArray<PxContactPoint>;
        set_contacts(value: ReadonlyArray<PxContactPoint>): void;
        count: number;
        get_count(): number;
        set_count(value: number): void;
        pad: number;
        get_pad(): number;
        set_pad(value: number): void;
        static readonly MAX_CONTACTS: number;
        static get_MAX_CONTACTS(): number;
    }
    class PxContactPair {
        extractContacts(userBuffer: PxContactPairPoint, bufferSize: number): number;
        shapes: ReadonlyArray<PxShape>;
        get_shapes(): ReadonlyArray<PxShape>;
        set_shapes(value: ReadonlyArray<PxShape>): void;
        contactCount: number;
        get_contactCount(): number;
        set_contactCount(value: number): void;
        patchCount: number;
        get_patchCount(): number;
        set_patchCount(value: number): void;
        flags: PxContactPairFlags;
        get_flags(): PxContactPairFlags;
        set_flags(value: PxContactPairFlags): void;
        events: PxPairFlags;
        get_events(): PxPairFlags;
        set_events(value: PxPairFlags): void;
    }
    class PxContactPairFlags {
        constructor(flags: number);
        isSet(flag: PxContactPairFlagEnum): boolean;
        raise(flag: PxContactPairFlagEnum): void;
        clear(flag: PxContactPairFlagEnum): void;
    }
    class PxContactPairHeader {
        actors: ReadonlyArray<PxActor>;
        get_actors(): ReadonlyArray<PxActor>;
        set_actors(value: ReadonlyArray<PxActor>): void;
        flags: PxContactPairHeaderFlags;
        get_flags(): PxContactPairHeaderFlags;
        set_flags(value: PxContactPairHeaderFlags): void;
        pairs: PxContactPair;
        get_pairs(): PxContactPair;
        set_pairs(value: PxContactPair): void;
        nbPairs: number;
        get_nbPairs(): number;
        set_nbPairs(value: number): void;
    }
    class PxContactPairHeaderFlags {
        constructor(flags: number);
        isSet(flag: PxContactPairHeaderFlagEnum): boolean;
        raise(flag: PxContactPairHeaderFlagEnum): void;
        clear(flag: PxContactPairHeaderFlagEnum): void;
    }
    class PxContactPairPoint {
        position: PxVec3;
        get_position(): PxVec3;
        set_position(value: PxVec3): void;
        separation: number;
        get_separation(): number;
        set_separation(value: number): void;
        normal: PxVec3;
        get_normal(): PxVec3;
        set_normal(value: PxVec3): void;
        internalFaceIndex0: number;
        get_internalFaceIndex0(): number;
        set_internalFaceIndex0(value: number): void;
        impulse: PxVec3;
        get_impulse(): PxVec3;
        set_impulse(value: PxVec3): void;
        internalFaceIndex1: number;
        get_internalFaceIndex1(): number;
        set_internalFaceIndex1(value: number): void;
    }
    class PxContactPoint {
        constructor();
        normal: PxVec3;
        get_normal(): PxVec3;
        set_normal(value: PxVec3): void;
        point: PxVec3;
        get_point(): PxVec3;
        set_point(value: PxVec3): void;
        targetVel: PxVec3;
        get_targetVel(): PxVec3;
        set_targetVel(value: PxVec3): void;
        separation: number;
        get_separation(): number;
        set_separation(value: number): void;
        maxImpulse: number;
        get_maxImpulse(): number;
        set_maxImpulse(value: number): void;
        staticFriction: number;
        get_staticFriction(): number;
        set_staticFriction(value: number): void;
        materialFlags: number;
        get_materialFlags(): number;
        set_materialFlags(value: number): void;
        internalFaceIndex1: number;
        get_internalFaceIndex1(): number;
        set_internalFaceIndex1(value: number): void;
        dynamicFriction: number;
        get_dynamicFriction(): number;
        set_dynamicFriction(value: number): void;
        restitution: number;
        get_restitution(): number;
        set_restitution(value: number): void;
        damping: number;
        get_damping(): number;
        set_damping(value: number): void;
    }
    class PxController {
        getType(): PxControllerShapeTypeEnum;
        release(): void;
        move(disp: PxVec3, minDist: number, elapsedTime: number, filters: PxControllerFilters, obstacles?: PxObstacleContext): PxControllerCollisionFlags;
        setPosition(position: PxExtendedVec3): boolean;
        getPosition(): PxExtendedVec3;
        setFootPosition(position: PxExtendedVec3): boolean;
        getFootPosition(): PxExtendedVec3;
        getActor(): PxRigidDynamic;
        setStepOffset(offset: number): void;
        getStepOffset(): number;
        setNonWalkableMode(flag: PxControllerNonWalkableModeEnum): void;
        getNonWalkableMode(): PxControllerNonWalkableModeEnum;
        getContactOffset(): number;
        setContactOffset(offset: number): void;
        getUpDirection(): PxVec3;
        setUpDirection(up: PxVec3): void;
        getSlopeLimit(): number;
        setSlopeLimit(slopeLimit: number): void;
        invalidateCache(): void;
        getScene(): PxScene;
        getUserData(): VoidPtr;
        setUserData(userData: VoidPtr): void;
        getState(state: PxControllerState): void;
        getStats(stats: PxControllerStats): void;
        resize(height: number): void;
    }
    class PxControllerBehaviorCallback {
    }
    class PxControllerBehaviorCallbackImpl {
        constructor();
        getShapeBehaviorFlags(shape: PxShape, actor: PxActor): number;
        getControllerBehaviorFlags(controller: PxController): number;
        getObstacleBehaviorFlags(obstacle: PxObstacle): number;
    }
    class PxControllerBehaviorFlags {
        constructor(flags: number);
        isSet(flag: PxControllerBehaviorFlagEnum): boolean;
        raise(flag: PxControllerBehaviorFlagEnum): void;
        clear(flag: PxControllerBehaviorFlagEnum): void;
    }
    class PxControllerCollisionFlags {
        constructor(flags: number);
        isSet(flag: PxControllerCollisionFlagEnum): boolean;
        raise(flag: PxControllerCollisionFlagEnum): void;
        clear(flag: PxControllerCollisionFlagEnum): void;
    }
    class PxControllerDesc {
        isValid(): boolean;
        getType(): PxControllerShapeTypeEnum;
        position: PxExtendedVec3;
        get_position(): PxExtendedVec3;
        set_position(value: PxExtendedVec3): void;
        upDirection: PxVec3;
        get_upDirection(): PxVec3;
        set_upDirection(value: PxVec3): void;
        slopeLimit: number;
        get_slopeLimit(): number;
        set_slopeLimit(value: number): void;
        invisibleWallHeight: number;
        get_invisibleWallHeight(): number;
        set_invisibleWallHeight(value: number): void;
        maxJumpHeight: number;
        get_maxJumpHeight(): number;
        set_maxJumpHeight(value: number): void;
        contactOffset: number;
        get_contactOffset(): number;
        set_contactOffset(value: number): void;
        stepOffset: number;
        get_stepOffset(): number;
        set_stepOffset(value: number): void;
        density: number;
        get_density(): number;
        set_density(value: number): void;
        scaleCoeff: number;
        get_scaleCoeff(): number;
        set_scaleCoeff(value: number): void;
        volumeGrowth: number;
        get_volumeGrowth(): number;
        set_volumeGrowth(value: number): void;
        reportCallback: PxUserControllerHitReport;
        get_reportCallback(): PxUserControllerHitReport;
        set_reportCallback(value: PxUserControllerHitReport): void;
        behaviorCallback: PxControllerBehaviorCallback;
        get_behaviorCallback(): PxControllerBehaviorCallback;
        set_behaviorCallback(value: PxControllerBehaviorCallback): void;
        nonWalkableMode: PxControllerNonWalkableModeEnum;
        get_nonWalkableMode(): PxControllerNonWalkableModeEnum;
        set_nonWalkableMode(value: PxControllerNonWalkableModeEnum): void;
        material: PxMaterial;
        get_material(): PxMaterial;
        set_material(value: PxMaterial): void;
        registerDeletionListener: boolean;
        get_registerDeletionListener(): boolean;
        set_registerDeletionListener(value: boolean): void;
        userData: VoidPtr;
        get_userData(): VoidPtr;
        set_userData(value: VoidPtr): void;
    }
    class PxControllerFilterCallback {
        filter(a: PxController, b: PxController): boolean;
    }
    class PxControllerFilterCallbackImpl {
        constructor();
        filter(a: PxController, b: PxController): boolean;
    }
    class PxControllerFilters {
        constructor(filterData?: PxFilterData);
        mFilterData: PxFilterData;
        get_mFilterData(): PxFilterData;
        set_mFilterData(value: PxFilterData): void;
        mFilterCallback: PxQueryFilterCallback;
        get_mFilterCallback(): PxQueryFilterCallback;
        set_mFilterCallback(value: PxQueryFilterCallback): void;
        mFilterFlags: PxQueryFlags;
        get_mFilterFlags(): PxQueryFlags;
        set_mFilterFlags(value: PxQueryFlags): void;
        mCCTFilterCallback: PxControllerFilterCallback;
        get_mCCTFilterCallback(): PxControllerFilterCallback;
        set_mCCTFilterCallback(value: PxControllerFilterCallback): void;
    }
    class PxControllerHit {
        controller: PxController;
        get_controller(): PxController;
        set_controller(value: PxController): void;
        worldPos: PxExtendedVec3;
        get_worldPos(): PxExtendedVec3;
        set_worldPos(value: PxExtendedVec3): void;
        worldNormal: PxVec3;
        get_worldNormal(): PxVec3;
        set_worldNormal(value: PxVec3): void;
        dir: PxVec3;
        get_dir(): PxVec3;
        set_dir(value: PxVec3): void;
        length: number;
        get_length(): number;
        set_length(value: number): void;
    }
    class PxControllerManager {
        release(): void;
        getScene(): PxScene;
        getNbControllers(): number;
        getController(index: number): PxController;
        createController(desc: PxControllerDesc): PxController;
        purgeControllers(): void;
        getNbObstacleContexts(): number;
        getObstacleContext(index: number): PxObstacleContext;
        createObstacleContext(): PxObstacleContext;
        computeInteractions(elapsedTime: number): void;
        setTessellation(flag: boolean, maxEdgeLength: number): void;
        setOverlapRecoveryModule(flag: boolean): void;
        setPreciseSweeps(flags: boolean): void;
        setPreventVerticalSlidingAgainstCeiling(flag: boolean): void;
        shiftOrigin(shift: PxVec3): void;
    }
    class PxControllerObstacleHit extends PxControllerHit {
        userData: VoidPtr;
        get_userData(): VoidPtr;
        set_userData(value: VoidPtr): void;
    }
    class PxControllerShapeHit extends PxControllerHit {
        shape: PxShape;
        get_shape(): PxShape;
        set_shape(value: PxShape): void;
        actor: PxRigidActor;
        get_actor(): PxRigidActor;
        set_actor(value: PxRigidActor): void;
        triangleIndex: number;
        get_triangleIndex(): number;
        set_triangleIndex(value: number): void;
    }
    class PxControllerState {
        constructor();
        deltaXP: PxVec3;
        get_deltaXP(): PxVec3;
        set_deltaXP(value: PxVec3): void;
        touchedShape: PxShape;
        get_touchedShape(): PxShape;
        set_touchedShape(value: PxShape): void;
        touchedActor: PxRigidActor;
        get_touchedActor(): PxRigidActor;
        set_touchedActor(value: PxRigidActor): void;
        touchedObstacleHandle: number;
        get_touchedObstacleHandle(): number;
        set_touchedObstacleHandle(value: number): void;
        collisionFlags: number;
        get_collisionFlags(): number;
        set_collisionFlags(value: number): void;
        standOnAnotherCCT: boolean;
        get_standOnAnotherCCT(): boolean;
        set_standOnAnotherCCT(value: boolean): void;
        standOnObstacle: boolean;
        get_standOnObstacle(): boolean;
        set_standOnObstacle(value: boolean): void;
        isMovingUp: boolean;
        get_isMovingUp(): boolean;
        set_isMovingUp(value: boolean): void;
    }
    class PxControllerStats {
        nbIterations: number;
        get_nbIterations(): number;
        set_nbIterations(value: number): void;
        nbFullUpdates: number;
        get_nbFullUpdates(): number;
        set_nbFullUpdates(value: number): void;
        nbPartialUpdates: number;
        get_nbPartialUpdates(): number;
        set_nbPartialUpdates(value: number): void;
        nbTessellation: number;
        get_nbTessellation(): number;
        set_nbTessellation(value: number): void;
    }
    class PxControllersHit extends PxControllerHit {
        other: PxController;
        get_other(): PxController;
        set_other(value: PxController): void;
    }
    class PxConvexCoreBox {
        constructor(eX: number, eY: number, eZ: number);
        extents: PxVec3;
        get_extents(): PxVec3;
        set_extents(value: PxVec3): void;
    }
    class PxConvexCoreCone {
        constructor(height: number, radius: number);
        height: number;
        get_height(): number;
        set_height(value: number): void;
        radius: number;
        get_radius(): number;
        set_radius(value: number): void;
    }
    class PxConvexCoreCylinder {
        constructor(height: number, radius: number);
        height: number;
        get_height(): number;
        set_height(value: number): void;
        radius: number;
        get_radius(): number;
        set_radius(value: number): void;
    }
    class PxConvexCoreEllipsoid {
        constructor(rX: number, rY: number, rZ: number);
        radii: PxVec3;
        get_radii(): PxVec3;
        set_radii(value: PxVec3): void;
    }
    class PxConvexCoreGeometry extends PxGeometry {
        getCoreType(): PxConvexCoreTypeEnum;
        getCoreData(): VoidPtr;
        getMargin(): number;
        isValid(): boolean;
    }
    class PxConvexCoreGeometryFactory {
        static createFromBox(box: PxConvexCoreBox, margin: number): PxConvexCoreGeometry;
        static createFromCone(cone: PxConvexCoreCone, margin: number): PxConvexCoreGeometry;
        static createFromCylinder(cylinder: PxConvexCoreCylinder, margin: number): PxConvexCoreGeometry;
        static createFromEllipsoid(ellipsoid: PxConvexCoreEllipsoid, margin: number): PxConvexCoreGeometry;
        static createFromPoint(point: PxConvexCorePoint, margin: number): PxConvexCoreGeometry;
        static createFromSegment(segment: PxConvexCoreSegment, margin: number): PxConvexCoreGeometry;
    }
    class PxConvexCorePoint {
        constructor();
    }
    class PxConvexCoreSegment {
        constructor(length: number);
        length: number;
        get_length(): number;
        set_length(value: number): void;
    }
    class PxConvexFlags {
        constructor(flags: number);
        isSet(flag: PxConvexFlagEnum): boolean;
        raise(flag: PxConvexFlagEnum): void;
        clear(flag: PxConvexFlagEnum): void;
    }
    class PxConvexMesh extends PxRefCounted {
        getNbVertices(): number;
        getVertices(): PxVec3;
        getIndexBuffer(): PxU8ConstPtr;
        getNbPolygons(): number;
        getPolygonData(index: number, data: PxHullPolygon): boolean;
        getLocalBounds(): PxBounds3;
        isGpuCompatible(): boolean;
    }
    class PxConvexMeshDesc {
        constructor();
        points: PxBoundedData;
        get_points(): PxBoundedData;
        set_points(value: PxBoundedData): void;
        flags: PxConvexFlags;
        get_flags(): PxConvexFlags;
        set_flags(value: PxConvexFlags): void;
    }
    class PxConvexMeshGeometry extends PxGeometry {
        constructor(mesh: PxConvexMesh, scaling?: PxMeshScale, flags?: PxConvexMeshGeometryFlags);
        scale: PxMeshScale;
        get_scale(): PxMeshScale;
        set_scale(value: PxMeshScale): void;
        convexMesh: PxConvexMesh;
        get_convexMesh(): PxConvexMesh;
        set_convexMesh(value: PxConvexMesh): void;
        meshFlags: PxConvexMeshGeometryFlags;
        get_meshFlags(): PxConvexMeshGeometryFlags;
        set_meshFlags(value: PxConvexMeshGeometryFlags): void;
    }
    class PxConvexMeshGeometryFlags {
        constructor(flags: number);
        isSet(flag: PxConvexMeshGeometryFlagEnum): boolean;
        raise(flag: PxConvexMeshGeometryFlagEnum): void;
        clear(flag: PxConvexMeshGeometryFlagEnum): void;
    }
    class PxCookingParams {
        constructor(sc: PxTolerancesScale);
        areaTestEpsilon: number;
        get_areaTestEpsilon(): number;
        set_areaTestEpsilon(value: number): void;
        planeTolerance: number;
        get_planeTolerance(): number;
        set_planeTolerance(value: number): void;
        convexMeshCookingType: PxConvexMeshCookingTypeEnum;
        get_convexMeshCookingType(): PxConvexMeshCookingTypeEnum;
        set_convexMeshCookingType(value: PxConvexMeshCookingTypeEnum): void;
        suppressTriangleMeshRemapTable: boolean;
        get_suppressTriangleMeshRemapTable(): boolean;
        set_suppressTriangleMeshRemapTable(value: boolean): void;
        buildTriangleAdjacencies: boolean;
        get_buildTriangleAdjacencies(): boolean;
        set_buildTriangleAdjacencies(value: boolean): void;
        buildGPUData: boolean;
        get_buildGPUData(): boolean;
        set_buildGPUData(value: boolean): void;
        scale: PxTolerancesScale;
        get_scale(): PxTolerancesScale;
        set_scale(value: PxTolerancesScale): void;
        meshPreprocessParams: PxMeshPreprocessingFlags;
        get_meshPreprocessParams(): PxMeshPreprocessingFlags;
        set_meshPreprocessParams(value: PxMeshPreprocessingFlags): void;
        meshWeldTolerance: number;
        get_meshWeldTolerance(): number;
        set_meshWeldTolerance(value: number): void;
        midphaseDesc: PxMidphaseDesc;
        get_midphaseDesc(): PxMidphaseDesc;
        set_midphaseDesc(value: PxMidphaseDesc): void;
        gaussMapLimit: number;
        get_gaussMapLimit(): number;
        set_gaussMapLimit(value: number): void;
    }
    class PxCpuDispatcher {
    }
    class PxD6Joint extends PxJoint {
        setMotion(axis: PxD6AxisEnum, type: PxD6MotionEnum): void;
        getMotion(axis: PxD6AxisEnum): PxD6MotionEnum;
        getTwistAngle(): number;
        getSwingYAngle(): number;
        getSwingZAngle(): number;
        setDistanceLimit(limit: PxJointLinearLimit): void;
        setLinearLimit(axis: PxD6AxisEnum, limit: PxJointLinearLimitPair): void;
        setTwistLimit(limit: PxJointAngularLimitPair): void;
        setSwingLimit(limit: PxJointLimitCone): void;
        setPyramidSwingLimit(limit: PxJointLimitPyramid): void;
        setDrive(index: PxD6DriveEnum, drive: PxD6JointDrive): void;
        getDrive(index: PxD6DriveEnum): PxD6JointDrive;
        setDrivePosition(pose: PxTransform, autowake?: boolean): void;
        getDrivePosition(): PxTransform;
        setDriveVelocity(linear: PxVec3, angular: PxVec3): void;
        getDriveVelocity(linear: PxVec3, angular: PxVec3): void;
        setAngularDriveConfig(config: PxD6AngularDriveConfigEnum): void;
        getAngularDriveConfig(): PxD6AngularDriveConfigEnum;
    }
    class PxD6JointDrive extends PxSpring {
        constructor();
        constructor(driveStiffness: number, driveDamping: number, driveForceLimit: number, isAcceleration?: boolean);
        forceLimit: number;
        get_forceLimit(): number;
        set_forceLimit(value: number): void;
        flags: PxD6JointDriveFlags;
        get_flags(): PxD6JointDriveFlags;
        set_flags(value: PxD6JointDriveFlags): void;
    }
    class PxD6JointDriveFlags {
        constructor(flags: number);
        isSet(flag: PxD6JointDriveFlagEnum): boolean;
        raise(flag: PxD6JointDriveFlagEnum): void;
        clear(flag: PxD6JointDriveFlagEnum): void;
    }
    class PxDebugLine {
        pos0: PxVec3;
        get_pos0(): PxVec3;
        set_pos0(value: PxVec3): void;
        color0: number;
        get_color0(): number;
        set_color0(value: number): void;
        pos1: PxVec3;
        get_pos1(): PxVec3;
        set_pos1(value: PxVec3): void;
        color1: number;
        get_color1(): number;
        set_color1(value: number): void;
    }
    class PxDebugPoint {
        pos: PxVec3;
        get_pos(): PxVec3;
        set_pos(value: PxVec3): void;
        color: number;
        get_color(): number;
        set_color(value: number): void;
    }
    class PxDebugTriangle {
        pos0: PxVec3;
        get_pos0(): PxVec3;
        set_pos0(value: PxVec3): void;
        color0: number;
        get_color0(): number;
        set_color0(value: number): void;
        pos1: PxVec3;
        get_pos1(): PxVec3;
        set_pos1(value: PxVec3): void;
        color1: number;
        get_color1(): number;
        set_color1(value: number): void;
        pos2: PxVec3;
        get_pos2(): PxVec3;
        set_pos2(value: PxVec3): void;
        color2: number;
        get_color2(): number;
        set_color2(value: number): void;
    }
    class PxDefaultAllocator {
        constructor();
    }
    class PxDefaultCpuDispatcher extends PxCpuDispatcher {
    }
    class PxDefaultErrorCallback extends PxErrorCallback {
        constructor();
    }
    class PxDefaultMemoryInputData extends PxInputData {
        constructor(data: PxU8Ptr, length: number);
        read(dest: VoidPtr, count: number): number;
        getLength(): number;
        seek(pos: number): void;
        tell(): number;
        isValid(): boolean;
    }
    class PxDefaultMemoryOutputStream extends PxOutputStream {
        constructor();
        write(src: VoidPtr, count: number): void;
        getSize(): number;
        getData(): VoidPtr;
        isValid(): boolean;
    }
    class PxDim3 {
        constructor();
        x: number;
        get_x(): number;
        set_x(value: number): void;
        y: number;
        get_y(): number;
        set_y(value: number): void;
        z: number;
        get_z(): number;
        set_z(value: number): void;
    }
    class PxDistanceJoint extends PxJoint {
        getDistance(): number;
        setMinDistance(distance: number): void;
        getMinDistance(): number;
        setMaxDistance(distance: number): void;
        getMaxDistance(): number;
        setTolerance(tolerance: number): void;
        getTolerance(): number;
        setStiffness(stiffness: number): void;
        getStiffness(): number;
        setDamping(damping: number): void;
        getDamping(): number;
        setDistanceJointFlags(flags: PxDistanceJointFlags): void;
        setDistanceJointFlag(flag: PxDistanceJointFlagEnum, value: boolean): void;
        getDistanceJointFlags(): PxDistanceJointFlags;
    }
    class PxDistanceJointFlags {
        constructor(flags: number);
        isSet(flag: PxDistanceJointFlagEnum): boolean;
        raise(flag: PxDistanceJointFlagEnum): void;
        clear(flag: PxDistanceJointFlagEnum): void;
    }
    class PxDominanceGroupPair {
        constructor(a: number, b: number);
        dominance0: number;
        get_dominance0(): number;
        set_dominance0(value: number): void;
        dominance1: number;
        get_dominance1(): number;
        set_dominance1(value: number): void;
    }
    class PxErrorCallback {
        reportError(code: PxErrorCodeEnum, message: string, file: string, line: number): void;
    }
    class PxErrorCallbackImpl {
        constructor();
        reportError(code: PxErrorCodeEnum, message: string, file: string, line: number): void;
    }
    class PxExtendedVec3 {
        constructor();
        constructor(x: number, y: number, z: number);
        x: number;
        get_x(): number;
        set_x(value: number): void;
        y: number;
        get_y(): number;
        set_y(value: number): void;
        z: number;
        get_z(): number;
        set_z(value: number): void;
    }
    class PxExtensionTopLevelFunctions {
        static CreatePlane(sdk: PxPhysics, plane: PxPlane, material: PxMaterial, filterData: PxFilterData): PxRigidStatic;
    }
    class PxFilterData {
        constructor();
        constructor(w0: number, w1: number, w2: number, w3: number);
        word0: number;
        get_word0(): number;
        set_word0(value: number): void;
        word1: number;
        get_word1(): number;
        set_word1(value: number): void;
        word2: number;
        get_word2(): number;
        set_word2(value: number): void;
        word3: number;
        get_word3(): number;
        set_word3(value: number): void;
    }
    class PxFixedJoint extends PxJoint {
    }
    class PxFoundation {
        release(): void;
    }
    class PxGearJoint extends PxJoint {
        setHinges(hinge0: PxBase, hinge1: PxBase): boolean;
        setGearRatio(ratio: number): void;
        getGearRatio(): number;
    }
    class PxGeomRaycastHit extends PxLocationHit {
        hadInitialOverlap(): boolean;
        u: number;
        get_u(): number;
        set_u(value: number): void;
        v: number;
        get_v(): number;
        set_v(value: number): void;
    }
    class PxGeomSweepHit extends PxLocationHit {
        hadInitialOverlap(): boolean;
    }
    class PxGeometry {
        getType(): PxGeometryTypeEnum;
    }
    class PxGeometryHolder {
        constructor();
        constructor(geometry: PxGeometry);
        getType(): PxGeometryTypeEnum;
        sphere(): PxSphereGeometry;
        plane(): PxPlaneGeometry;
        capsule(): PxCapsuleGeometry;
        box(): PxBoxGeometry;
        convexMesh(): PxConvexMeshGeometry;
        triangleMesh(): PxTriangleMeshGeometry;
        heightField(): PxHeightFieldGeometry;
        storeAny(geometry: PxGeometry): void;
    }
    class PxGeometryQuery {
        static sweep(unitDir: PxVec3, maxDist: number, geom0: PxGeometry, pose0: PxTransform, geom1: PxGeometry, pose1: PxTransform, sweepHit: PxSweepHit, hitFlags?: PxHitFlags, inflation?: number): boolean;
        static overlap(geom0: PxGeometry, pose0: PxTransform, geom1: PxGeometry, pose1: PxTransform): boolean;
        static raycast(origin: PxVec3, unitDir: PxVec3, geom: PxGeometry, pose: PxTransform, maxDist: number, hitFlags: PxHitFlags, maxHits: number, rayHits: PxRaycastHit): number;
        static pointDistance(point: PxVec3, geom: PxGeometry, pose: PxTransform, closestPoint?: PxVec3): number;
        static computeGeomBounds(bounds: PxBounds3, geom: PxGeometry, pose: PxTransform, inflation?: number): void;
        static isValid(geom: PxGeometry): boolean;
    }
    class PxGjkQuery {
        static proximityInfo(a: Support, b: Support, poseA: PxTransform, poseB: PxTransform, contactDistance: number, toleranceLength: number, result: PxGjkQueryProximityInfoResult): boolean;
        static raycast(shape: Support, pose: PxTransform, rayStart: PxVec3, unitDir: PxVec3, maxDist: number, result: PxGjkQueryRaycastResult): boolean;
        static overlap(a: Support, b: Support, poseA: PxTransform, poseB: PxTransform): boolean;
        static sweep(a: Support, b: Support, poseA: PxTransform, poseB: PxTransform, unitDir: PxVec3, maxDist: number, result: PxGjkQuerySweepResult): boolean;
    }
    class PxGjkQueryExt {
        static generateContacts(a: Support, b: Support, poseA: PxTransform, poseB: PxTransform, contactDistance: number, toleranceLength: number, contactBuffer: PxContactBuffer): boolean;
    }
    class PxGjkQueryProximityInfoResult {
        constructor();
        success: boolean;
        get_success(): boolean;
        set_success(value: boolean): void;
        pointA: PxVec3;
        get_pointA(): PxVec3;
        set_pointA(value: PxVec3): void;
        pointB: PxVec3;
        get_pointB(): PxVec3;
        set_pointB(value: PxVec3): void;
        separatingAxis: PxVec3;
        get_separatingAxis(): PxVec3;
        set_separatingAxis(value: PxVec3): void;
        separation: number;
        get_separation(): number;
        set_separation(value: number): void;
    }
    class PxGjkQueryRaycastResult {
        constructor();
        success: boolean;
        get_success(): boolean;
        set_success(value: boolean): void;
        t: number;
        get_t(): number;
        set_t(value: number): void;
        n: PxVec3;
        get_n(): PxVec3;
        set_n(value: PxVec3): void;
        p: PxVec3;
        get_p(): PxVec3;
        set_p(value: PxVec3): void;
    }
    class PxGjkQuerySweepResult {
        constructor();
        success: boolean;
        get_success(): boolean;
        set_success(value: boolean): void;
        t: number;
        get_t(): number;
        set_t(value: number): void;
        n: PxVec3;
        get_n(): PxVec3;
        set_n(value: PxVec3): void;
        p: PxVec3;
        get_p(): PxVec3;
        set_p(value: PxVec3): void;
    }
    class PxHeightField extends PxRefCounted {
        saveCells(destBuffer: VoidPtr, destBufferSize: number): number;
        modifySamples(startCol: number, startRow: number, subfieldDesc: PxHeightFieldDesc, shrinkBounds?: boolean): boolean;
        getNbRows(): number;
        getNbColumns(): number;
        getFormat(): PxHeightFieldFormatEnum;
        getSampleStride(): number;
        getConvexEdgeThreshold(): number;
        getFlags(): PxHeightFieldFlags;
        getHeight(x: number, z: number): number;
        getTriangleMaterialIndex(triangleIndex: number): number;
        getTriangleNormal(triangleIndex: number): PxVec3;
        getSample(row: number, column: number): PxHeightFieldSample;
        getTimestamp(): number;
    }
    class PxHeightFieldDesc {
        constructor();
        setToDefault(): void;
        isValid(): boolean;
        nbRows: number;
        get_nbRows(): number;
        set_nbRows(value: number): void;
        nbColumns: number;
        get_nbColumns(): number;
        set_nbColumns(value: number): void;
        format: PxHeightFieldFormatEnum;
        get_format(): PxHeightFieldFormatEnum;
        set_format(value: PxHeightFieldFormatEnum): void;
        samples: PxStridedData;
        get_samples(): PxStridedData;
        set_samples(value: PxStridedData): void;
        convexEdgeThreshold: number;
        get_convexEdgeThreshold(): number;
        set_convexEdgeThreshold(value: number): void;
        flags: PxHeightFieldFlags;
        get_flags(): PxHeightFieldFlags;
        set_flags(value: PxHeightFieldFlags): void;
    }
    class PxHeightFieldFlags {
        constructor(flags: number);
        isSet(flag: PxHeightFieldFlagEnum): boolean;
        raise(flag: PxHeightFieldFlagEnum): void;
        clear(flag: PxHeightFieldFlagEnum): void;
    }
    class PxHeightFieldGeometry extends PxGeometry {
        constructor();
        constructor(hf: PxHeightField, flags: PxMeshGeometryFlags, heightScale: number, rowScale: number, columnScale: number);
        isValid(): boolean;
        heightField: PxHeightField;
        get_heightField(): PxHeightField;
        set_heightField(value: PxHeightField): void;
        heightScale: number;
        get_heightScale(): number;
        set_heightScale(value: number): void;
        rowScale: number;
        get_rowScale(): number;
        set_rowScale(value: number): void;
        columnScale: number;
        get_columnScale(): number;
        set_columnScale(value: number): void;
        heightFieldFlags: PxMeshGeometryFlags;
        get_heightFieldFlags(): PxMeshGeometryFlags;
        set_heightFieldFlags(value: PxMeshGeometryFlags): void;
    }
    class PxHeightFieldSample {
        constructor();
        tessFlag(): number;
        clearTessFlag(): void;
        setTessFlag(): void;
        height: number;
        get_height(): number;
        set_height(value: number): void;
        materialIndex0: number;
        get_materialIndex0(): number;
        set_materialIndex0(value: number): void;
        materialIndex1: number;
        get_materialIndex1(): number;
        set_materialIndex1(value: number): void;
    }
    class PxHitFlags {
        constructor(flags: number);
        isSet(flag: PxHitFlagEnum): boolean;
        raise(flag: PxHitFlagEnum): void;
        clear(flag: PxHitFlagEnum): void;
    }
    class PxHullPolygon {
        constructor();
        mPlane: ReadonlyArray<number>;
        get_mPlane(): ReadonlyArray<number>;
        set_mPlane(value: ReadonlyArray<number>): void;
        mNbVerts: number;
        get_mNbVerts(): number;
        set_mNbVerts(value: number): void;
        mIndexBase: number;
        get_mIndexBase(): number;
        set_mIndexBase(value: number): void;
    }
    class PxI32ConstPtr {
    }
    class PxI32Ptr extends PxI32ConstPtr {
    }
    class PxInputData {
    }
    class PxInsertionCallback {
    }
    class PxJoint extends PxBase {
        setActors(actor0: PxRigidActor, actor1: PxRigidActor): void;
        setLocalPose(actor: PxJointActorIndexEnum, localPose: PxTransform): void;
        getLocalPose(actor: PxJointActorIndexEnum): PxTransform;
        getRelativeTransform(): PxTransform;
        getRelativeLinearVelocity(): PxVec3;
        getRelativeAngularVelocity(): PxVec3;
        setBreakForce(force: number, torque: number): void;
        setConstraintFlags(flags: PxConstraintFlags): void;
        setConstraintFlag(flag: PxConstraintFlagEnum, value: boolean): void;
        getConstraintFlags(): PxConstraintFlags;
        setInvMassScale0(invMassScale: number): void;
        getInvMassScale0(): number;
        setInvMassScale1(invMassScale: number): void;
        getInvMassScale1(): number;
        setInvInertiaScale0(invInertiaScale: number): void;
        getInvInertiaScale0(): number;
        setInvInertiaScale1(invInertiaScale: number): void;
        getInvInertiaScale1(): number;
        getConstraint(): PxConstraint;
        setName(name: string): void;
        getName(): string;
        getScene(): PxScene;
        userData: VoidPtr;
        get_userData(): VoidPtr;
        set_userData(value: VoidPtr): void;
    }
    class PxJointAngularLimitPair extends PxJointLimitParameters {
        constructor(lowerLimit: number, upperLimit: number);
        constructor(lowerLimit: number, upperLimit: number, spring: PxSpring);
        upper: number;
        get_upper(): number;
        set_upper(value: number): void;
        lower: number;
        get_lower(): number;
        set_lower(value: number): void;
    }
    class PxJointLimitCone extends PxJointLimitParameters {
        constructor(yLimitAngle: number, zLimitAngle: number);
        constructor(yLimitAngle: number, zLimitAngle: number, spring: PxSpring);
        yAngle: number;
        get_yAngle(): number;
        set_yAngle(value: number): void;
        zAngle: number;
        get_zAngle(): number;
        set_zAngle(value: number): void;
    }
    class PxJointLimitParameters {
        isValid(): boolean;
        isSoft(): boolean;
        restitution: number;
        get_restitution(): number;
        set_restitution(value: number): void;
        bounceThreshold: number;
        get_bounceThreshold(): number;
        set_bounceThreshold(value: number): void;
        stiffness: number;
        get_stiffness(): number;
        set_stiffness(value: number): void;
        damping: number;
        get_damping(): number;
        set_damping(value: number): void;
    }
    class PxJointLimitPyramid extends PxJointLimitParameters {
        constructor(yLimitAngleMin: number, yLimitAngleMax: number, zLimitAngleMin: number, zLimitAngleMax: number);
        constructor(yLimitAngleMin: number, yLimitAngleMax: number, zLimitAngleMin: number, zLimitAngleMax: number, spring: PxSpring);
        yAngleMin: number;
        get_yAngleMin(): number;
        set_yAngleMin(value: number): void;
        yAngleMax: number;
        get_yAngleMax(): number;
        set_yAngleMax(value: number): void;
        zAngleMin: number;
        get_zAngleMin(): number;
        set_zAngleMin(value: number): void;
        zAngleMax: number;
        get_zAngleMax(): number;
        set_zAngleMax(value: number): void;
    }
    class PxJointLinearLimit extends PxJointLimitParameters {
        constructor(extent: number, spring: PxSpring);
        value: number;
        get_value(): number;
        set_value(value: number): void;
    }
    class PxJointLinearLimitPair extends PxJointLimitParameters {
        constructor(lowerLimit: number, upperLimit: number, spring: PxSpring);
        upper: number;
        get_upper(): number;
        set_upper(value: number): void;
        lower: number;
        get_lower(): number;
        set_lower(value: number): void;
    }
    class PxLocationHit extends PxQueryHit {
        flags: PxHitFlags;
        get_flags(): PxHitFlags;
        set_flags(value: PxHitFlags): void;
        position: PxVec3;
        get_position(): PxVec3;
        set_position(value: PxVec3): void;
        normal: PxVec3;
        get_normal(): PxVec3;
        set_normal(value: PxVec3): void;
        distance: number;
        get_distance(): number;
        set_distance(value: number): void;
    }
    class PxMassProperties {
        constructor();
        constructor(m: number, inertiaT: PxMat33, com: PxVec3);
        constructor(geometry: PxGeometry);
        translate(t: PxVec3): void;
        static getMassSpaceInertia(inertia: PxMat33, massFrame: PxQuat): PxVec3;
        static translateInertia(inertia: PxMat33, mass: number, t: PxVec3): PxMat33;
        static rotateInertia(inertia: PxMat33, q: PxQuat): PxMat33;
        static scaleInertia(inertia: PxMat33, scaleRotation: PxQuat, scale: PxVec3): PxMat33;
        static sum(props: PxMassProperties, transforms: PxTransform, count: number): PxMassProperties;
        inertiaTensor: PxMat33;
        get_inertiaTensor(): PxMat33;
        set_inertiaTensor(value: PxMat33): void;
        centerOfMass: PxVec3;
        get_centerOfMass(): PxVec3;
        set_centerOfMass(value: PxVec3): void;
        mass: number;
        get_mass(): number;
        set_mass(value: number): void;
    }
    class PxMat33 {
        constructor();
        constructor(r: PxIDENTITYEnum);
        constructor(col0: PxVec3, col1: PxVec3, col2: PxVec3);
        getTranspose(): PxMat33;
        getInverse(): PxMat33;
        getDeterminant(): number;
        transform(other: PxVec3): PxVec3;
        transformTranspose(other: PxVec3): PxVec3;
        column0: PxVec3;
        get_column0(): PxVec3;
        set_column0(value: PxVec3): void;
        column1: PxVec3;
        get_column1(): PxVec3;
        set_column1(value: PxVec3): void;
        column2: PxVec3;
        get_column2(): PxVec3;
        set_column2(value: PxVec3): void;
    }
    class PxMaterial extends PxBaseMaterial {
        setDynamicFriction(coef: number): void;
        getDynamicFriction(): number;
        setStaticFriction(coef: number): void;
        getStaticFriction(): number;
        setRestitution(coef: number): void;
        getRestitution(): number;
        setFlag(flag: PxMaterialFlagEnum, b: boolean): void;
        setFlags(flags: PxMaterialFlags): void;
        getFlags(): PxMaterialFlags;
        setFrictionCombineMode(combMode: PxCombineModeEnum): void;
        getFrictionCombineMode(): PxCombineModeEnum;
        setRestitutionCombineMode(combMode: PxCombineModeEnum): void;
        getRestitutionCombineMode(): PxCombineModeEnum;
        userData: VoidPtr;
        get_userData(): VoidPtr;
        set_userData(value: VoidPtr): void;
    }
    class PxMaterialConstPtr {
    }
    class PxMaterialFlags {
        constructor(flags: number);
        isSet(flag: PxMaterialFlagEnum): boolean;
        raise(flag: PxMaterialFlagEnum): void;
        clear(flag: PxMaterialFlagEnum): void;
    }
    class PxMaterialPtr {
    }
    class PxMeshFlags {
        constructor(flags: number);
        isSet(flag: PxMeshFlagEnum): boolean;
        raise(flag: PxMeshFlagEnum): void;
        clear(flag: PxMeshFlagEnum): void;
    }
    class PxMeshGeometryFlags {
        constructor(flags: number);
        isSet(flag: PxMeshGeometryFlagEnum): boolean;
        raise(flag: PxMeshGeometryFlagEnum): void;
        clear(flag: PxMeshGeometryFlagEnum): void;
    }
    class PxMeshOverlapUtil {
        constructor();
        findOverlap(geom: PxGeometry, geomPose: PxTransform, meshGeom: PxTriangleMeshGeometry, meshPose: PxTransform): number;
        getResults(): PxU32ConstPtr;
        getNbResults(): number;
    }
    class PxMeshPreprocessingFlags {
        constructor(flags: number);
        isSet(flag: PxMeshPreprocessingFlagEnum): boolean;
        raise(flag: PxMeshPreprocessingFlagEnum): void;
        clear(flag: PxMeshPreprocessingFlagEnum): void;
    }
    class PxMeshScale {
        constructor();
        constructor(r: number);
        constructor(s: PxVec3, r: PxQuat);
    }
    class PxMidphaseDesc {
        constructor();
        getType(): PxMeshMidPhaseEnum;
        setToDefault(type: PxMeshMidPhaseEnum): void;
        isValid(): boolean;
        mBVH33Desc: PxBVH33MidphaseDesc;
        get_mBVH33Desc(): PxBVH33MidphaseDesc;
        set_mBVH33Desc(value: PxBVH33MidphaseDesc): void;
        mBVH34Desc: PxBVH34MidphaseDesc;
        get_mBVH34Desc(): PxBVH34MidphaseDesc;
        set_mBVH34Desc(value: PxBVH34MidphaseDesc): void;
    }
    class PxObstacle {
        getType(): PxGeometryTypeEnum;
        mUserData: VoidPtr;
        get_mUserData(): VoidPtr;
        set_mUserData(value: VoidPtr): void;
        mPos: PxExtendedVec3;
        get_mPos(): PxExtendedVec3;
        set_mPos(value: PxExtendedVec3): void;
        mRot: PxQuat;
        get_mRot(): PxQuat;
        set_mRot(value: PxQuat): void;
    }
    class PxObstacleContext {
        release(): void;
        getControllerManager(): PxControllerManager;
        addObstacle(obstacle: PxObstacle): number;
        removeObstacle(handle: number): boolean;
        updateObstacle(handle: number, obstacle: PxObstacle): boolean;
        getNbObstacles(): number;
        getObstacle(i: number): PxObstacle;
        getObstacleByHandle(handle: number): PxObstacle;
    }
    class PxOmniPvd {
        startSampling(): boolean;
        release(): void;
    }
    class PxOutputStream {
    }
    class PxOverlapBuffer10 extends PxOverlapCallback {
        constructor();
        getNbAnyHits(): number;
        getAnyHit(index: number): PxOverlapHit;
        getNbTouches(): number;
        getTouches(): PxOverlapHit;
        getTouch(index: number): PxOverlapHit;
        getMaxNbTouches(): number;
        block: PxOverlapHit;
        get_block(): PxOverlapHit;
        set_block(value: PxOverlapHit): void;
        hasBlock: boolean;
        get_hasBlock(): boolean;
        set_hasBlock(value: boolean): void;
    }
    class PxOverlapCallback {
        hasAnyHits(): boolean;
    }
    class PxOverlapHit extends PxQueryHit {
        actor: PxRigidActor;
        get_actor(): PxRigidActor;
        set_actor(value: PxRigidActor): void;
        shape: PxShape;
        get_shape(): PxShape;
        set_shape(value: PxShape): void;
    }
    class PxOverlapResult extends PxOverlapCallback {
        constructor();
        getNbAnyHits(): number;
        getAnyHit(index: number): PxOverlapHit;
        getNbTouches(): number;
        getTouch(index: number): PxOverlapHit;
        clear(): void;
        block: PxOverlapHit;
        get_block(): PxOverlapHit;
        set_block(value: PxOverlapHit): void;
        hasBlock: boolean;
        get_hasBlock(): boolean;
        set_hasBlock(value: boolean): void;
    }
    class PxPairFlags {
        constructor(flags: number);
        isSet(flag: PxPairFlagEnum): boolean;
        raise(flag: PxPairFlagEnum): void;
        clear(flag: PxPairFlagEnum): void;
    }
    class PxPhysics {
        release(): void;
        getFoundation(): PxFoundation;
        createAggregate(maxActor: number, maxShape: number, enableSelfCollision: boolean): PxAggregate;
        getTolerancesScale(): PxTolerancesScale;
        createScene(sceneDesc: PxSceneDesc): PxScene;
        createRigidStatic(pose: PxTransform): PxRigidStatic;
        createRigidDynamic(pose: PxTransform): PxRigidDynamic;
        createShape(geometry: PxGeometry, material: PxMaterial, isExclusive?: boolean, shapeFlags?: PxShapeFlags): PxShape;
        createTriangleMesh(stream: PxInputData): PxTriangleMesh;
        createConvexMesh(stream: PxInputData): PxConvexMesh;
        getNbShapes(): number;
        createArticulationReducedCoordinate(): PxArticulationReducedCoordinate;
        createMaterial(staticFriction: number, dynamicFriction: number, restitution: number): PxMaterial;
        getPhysicsInsertionCallback(): PxInsertionCallback;
    }
    class PxPlane {
        constructor();
        constructor(nx: number, ny: number, nz: number, distance: number);
        constructor(normal: PxVec3, distance: number);
        constructor(p0: PxVec3, p1: PxVec3, p2: PxVec3);
        distance(p: PxVec3): number;
        contains(p: PxVec3): boolean;
        project(p: PxVec3): PxVec3;
        pointInPlane(): PxVec3;
        normalize(): void;
        transform(pose: PxTransform): PxPlane;
        inverseTransform(pose: PxTransform): PxPlane;
        n: PxVec3;
        get_n(): PxVec3;
        set_n(value: PxVec3): void;
        d: number;
        get_d(): number;
        set_d(value: number): void;
    }
    class PxPlaneGeometry extends PxGeometry {
        constructor();
    }
    class PxPrismaticJoint extends PxJoint {
        getPosition(): number;
        getVelocity(): number;
        setLimit(limit: PxJointLinearLimitPair): void;
        setPrismaticJointFlags(flags: PxPrismaticJointFlags): void;
        setPrismaticJointFlag(flag: PxPrismaticJointFlagEnum, value: boolean): void;
        getPrismaticJointFlags(): PxPrismaticJointFlags;
    }
    class PxPrismaticJointFlags {
        constructor(flags: number);
        isSet(flag: PxPrismaticJointFlagEnum): boolean;
        raise(flag: PxPrismaticJointFlagEnum): void;
        clear(flag: PxPrismaticJointFlagEnum): void;
    }
    class PxPvd {
        connect(transport: PxPvdTransport, flags: PxPvdInstrumentationFlags): boolean;
        release(): void;
    }
    class PxPvdInstrumentationFlags {
        constructor(flags: number);
        isSet(flag: PxPvdInstrumentationFlagEnum): boolean;
        raise(flag: PxPvdInstrumentationFlagEnum): void;
        clear(flag: PxPvdInstrumentationFlagEnum): void;
    }
    class PxPvdSceneClient {
        setScenePvdFlag(flag: PxPvdSceneFlagEnum, value: boolean): void;
        setScenePvdFlags(flags: PxPvdSceneFlags): void;
        getScenePvdFlags(): PxPvdSceneFlags;
        updateCamera(name: string, origin: PxVec3, up: PxVec3, target: PxVec3): void;
    }
    class PxPvdSceneFlags {
        constructor(flags: number);
        isSet(flag: PxPvdSceneFlagEnum): boolean;
        raise(flag: PxPvdSceneFlagEnum): void;
        clear(flag: PxPvdSceneFlagEnum): void;
    }
    class PxPvdTransport {
        connect(): boolean;
        isConnected(): boolean;
        disconnect(): void;
        release(): void;
        flush(): void;
    }
    class PxQuat {
        constructor();
        constructor(r: PxIDENTITYEnum);
        constructor(nx: number, ny: number, nz: number, nw: number);
        constructor(angleRadians: number, unitAxis: PxVec3);
        isIdentity(): boolean;
        isFinite(): boolean;
        isUnit(): boolean;
        isSane(): boolean;
        getAngle(): number;
        getAngle(q: PxQuat): number;
        magnitudeSquared(): number;
        dot(q: PxQuat): number;
        getNormalized(): PxQuat;
        magnitude(): number;
        normalize(): number;
        getConjugate(): PxQuat;
        getImaginaryPart(): PxVec3;
        getBasisVector0(): PxVec3;
        getBasisVector1(): PxVec3;
        getBasisVector2(): PxVec3;
        rotate(v: PxVec3): PxVec3;
        rotateInv(v: PxVec3): PxVec3;
        x: number;
        get_x(): number;
        set_x(value: number): void;
        y: number;
        get_y(): number;
        set_y(value: number): void;
        z: number;
        get_z(): number;
        set_z(value: number): void;
        w: number;
        get_w(): number;
        set_w(value: number): void;
    }
    class PxQueryFilterCallback {
    }
    class PxQueryFilterCallbackImpl {
        constructor();
        simplePreFilter(filterData: PxFilterData, shape: PxShape, actor: PxRigidActor, queryFlags: PxHitFlags): number;
        simplePostFilter(filterData: PxFilterData, hit: PxQueryHit, shape: PxShape, actor: PxRigidActor): number;
    }
    class PxQueryFilterData {
        constructor();
        constructor(fd: PxFilterData, f: PxQueryFlags);
        constructor(f: PxQueryFlags);
        data: PxFilterData;
        get_data(): PxFilterData;
        set_data(value: PxFilterData): void;
        flags: PxQueryFlags;
        get_flags(): PxQueryFlags;
        set_flags(value: PxQueryFlags): void;
    }
    class PxQueryFlags {
        constructor(flags: number);
        isSet(flag: PxQueryFlagEnum): boolean;
        raise(flag: PxQueryFlagEnum): void;
        clear(flag: PxQueryFlagEnum): void;
    }
    class PxQueryHit {
        faceIndex: number;
        get_faceIndex(): number;
        set_faceIndex(value: number): void;
    }
    class PxRackAndPinionJoint extends PxJoint {
        setJoints(hinge: PxBase, prismatic: PxBase): boolean;
        setRatio(ratio: number): void;
        getRatio(): number;
        setData(nbRackTeeth: number, nbPinionTeeth: number, rackLength: number): boolean;
    }
    class PxRaycastBuffer10 extends PxRaycastCallback {
        constructor();
        getNbAnyHits(): number;
        getAnyHit(index: number): PxRaycastHit;
        getNbTouches(): number;
        getTouches(): PxRaycastHit;
        getTouch(index: number): PxRaycastHit;
        getMaxNbTouches(): number;
        block: PxRaycastHit;
        get_block(): PxRaycastHit;
        set_block(value: PxRaycastHit): void;
        hasBlock: boolean;
        get_hasBlock(): boolean;
        set_hasBlock(value: boolean): void;
    }
    class PxRaycastCallback {
        hasAnyHits(): boolean;
    }
    class PxRaycastHit extends PxGeomRaycastHit {
        constructor();
        actor: PxRigidActor;
        get_actor(): PxRigidActor;
        set_actor(value: PxRigidActor): void;
        shape: PxShape;
        get_shape(): PxShape;
        set_shape(value: PxShape): void;
    }
    class PxRaycastResult extends PxRaycastCallback {
        constructor();
        getNbAnyHits(): number;
        getAnyHit(index: number): PxRaycastHit;
        getNbTouches(): number;
        getTouch(index: number): PxRaycastHit;
        clear(): void;
        block: PxRaycastHit;
        get_block(): PxRaycastHit;
        set_block(value: PxRaycastHit): void;
        hasBlock: boolean;
        get_hasBlock(): boolean;
        set_hasBlock(value: boolean): void;
    }
    class PxRealConstPtr {
    }
    class PxRealPtr extends PxRealConstPtr {
    }
    class PxRefCounted extends PxBase {
        getReferenceCount(): number;
        acquireReference(): void;
    }
    class PxRenderBuffer {
        getNbPoints(): number;
        getPoints(): PxDebugPoint;
        addPoint(point: PxDebugPoint): void;
        getNbLines(): number;
        getLines(): PxDebugLine;
        addLine(line: PxDebugLine): void;
        reserveLines(nbLines: number): PxDebugLine;
        reservePoints(nbLines: number): PxDebugPoint;
        getNbTriangles(): number;
        getTriangles(): PxDebugTriangle;
        addTriangle(triangle: PxDebugTriangle): void;
        append(other: PxRenderBuffer): void;
        clear(): void;
        shift(delta: PxVec3): void;
        empty(): boolean;
    }
    class PxRevoluteJoint extends PxJoint {
        getAngle(): number;
        getVelocity(): number;
        setLimit(limits: PxJointAngularLimitPair): void;
        setDriveVelocity(velocity: number, autowake?: boolean): void;
        getDriveVelocity(): number;
        setDriveForceLimit(limit: number): void;
        getDriveForceLimit(): number;
        setDriveGearRatio(ratio: number): void;
        getDriveGearRatio(): number;
        setRevoluteJointFlags(flags: PxRevoluteJointFlags): void;
        setRevoluteJointFlag(flag: PxRevoluteJointFlagEnum, value: boolean): void;
        getRevoluteJointFlags(): PxRevoluteJointFlags;
    }
    class PxRevoluteJointFlags {
        constructor(flags: number);
        isSet(flag: PxRevoluteJointFlagEnum): boolean;
        raise(flag: PxRevoluteJointFlagEnum): void;
        clear(flag: PxRevoluteJointFlagEnum): void;
    }
    class PxRigidActor extends PxActor {
        getGlobalPose(): PxTransform;
        setGlobalPose(pose: PxTransform, autowake?: boolean): void;
        attachShape(shape: PxShape): boolean;
        detachShape(shape: PxShape, wakeOnLostTouch?: boolean): void;
        getNbShapes(): number;
        getShapes(userBuffer: PxShapePtr, bufferSize: number, startIndex: number): number;
        getNbConstraints(): number;
    }
    class PxRigidActorExt {
        static createExclusiveShape(actor: PxRigidActor, geometry: PxGeometry, material: PxMaterial, flags?: PxShapeFlags): PxShape;
    }
    class PxRigidBody extends PxRigidActor {
        setCMassLocalPose(pose: PxTransform): void;
        getCMassLocalPose(): PxTransform;
        setMass(mass: number): void;
        getMass(): number;
        getInvMass(): number;
        setMassSpaceInertiaTensor(m: PxVec3): void;
        getMassSpaceInertiaTensor(): PxVec3;
        getMassSpaceInvInertiaTensor(): PxVec3;
        setLinearDamping(linDamp: number): void;
        getLinearDamping(): number;
        setAngularDamping(angDamp: number): void;
        getAngularDamping(): number;
        getLinearVelocity(): PxVec3;
        getAngularVelocity(): PxVec3;
        setMaxLinearVelocity(maxLinVel: number): void;
        getMaxLinearVelocity(): number;
        setMaxAngularVelocity(maxAngVel: number): void;
        getMaxAngularVelocity(): number;
        addForce(force: PxVec3, mode?: PxForceModeEnum, autowake?: boolean): void;
        addTorque(torque: PxVec3, mode?: PxForceModeEnum, autowake?: boolean): void;
        clearForce(mode: PxForceModeEnum): void;
        clearTorque(mode: PxForceModeEnum): void;
        setForceAndTorque(force: PxVec3, torque: PxVec3, mode?: PxForceModeEnum): void;
        setRigidBodyFlag(flag: PxRigidBodyFlagEnum, value: boolean): void;
        setRigidBodyFlags(inFlags: PxRigidBodyFlags): void;
        getRigidBodyFlags(): PxRigidBodyFlags;
        setMinCCDAdvanceCoefficient(advanceCoefficient: number): void;
        getMinCCDAdvanceCoefficient(): number;
        setMaxDepenetrationVelocity(biasClamp: number): void;
        getMaxDepenetrationVelocity(): number;
        setMaxContactImpulse(maxImpulse: number): void;
        getMaxContactImpulse(): number;
        setContactSlopCoefficient(slopCoefficient: number): void;
        getContactSlopCoefficient(): number;
    }
    class PxRigidBodyExt {
        static updateMassAndInertia(body: PxRigidBody, density: number, massLocalPose?: PxVec3, includeNonSimShapes?: boolean): boolean;
        static setMassAndUpdateInertia(body: PxRigidBody, mass: number, massLocalPose?: PxVec3, includeNonSimShapes?: boolean): boolean;
        static addForceAtPos(body: PxRigidBody, force: PxVec3, pos: PxVec3, mode?: PxForceModeEnum, wakeup?: boolean): void;
        static addForceAtLocalPos(body: PxRigidBody, force: PxVec3, pos: PxVec3, mode?: PxForceModeEnum, wakeup?: boolean): void;
        static addLocalForceAtPos(body: PxRigidBody, force: PxVec3, pos: PxVec3, mode?: PxForceModeEnum, wakeup?: boolean): void;
        static addLocalForceAtLocalPos(body: PxRigidBody, force: PxVec3, pos: PxVec3, mode?: PxForceModeEnum, wakeup?: boolean): void;
        static getVelocityAtPos(body: PxRigidBody, pos: PxVec3): PxVec3;
        static getLocalVelocityAtLocalPos(body: PxRigidBody, pos: PxVec3): PxVec3;
        static getVelocityAtOffset(body: PxRigidBody, pos: PxVec3): PxVec3;
        static computeVelocityDeltaFromImpulse(body: PxRigidBody, impulsiveForce: PxVec3, impulsiveTorque: PxVec3, deltaLinearVelocity: PxVec3, deltaAngularVelocity: PxVec3): void;
        static computeVelocityDeltaFromImpulse(body: PxRigidBody, globalPose: PxTransform, point: PxVec3, impulse: PxVec3, invMassScale: number, invInertiaScale: number, deltaLinearVelocity: PxVec3, deltaAngularVelocity: PxVec3): void;
        static computeLinearAngularImpulse(body: PxRigidBody, globalPose: PxTransform, point: PxVec3, impulse: PxVec3, invMassScale: number, invInertiaScale: number, linearImpulse: PxVec3, angularImpulse: PxVec3): void;
    }
    class PxRigidBodyFlags {
        constructor(flags: number);
        isSet(flag: PxRigidBodyFlagEnum): boolean;
        raise(flag: PxRigidBodyFlagEnum): void;
        clear(flag: PxRigidBodyFlagEnum): void;
    }
    class PxRigidDynamic extends PxRigidBody {
        setKinematicTarget(destination: PxTransform): void;
        getKinematicTarget(target: PxTransform): boolean;
        isSleeping(): boolean;
        setSleepThreshold(threshold: number): void;
        getSleepThreshold(): number;
        setStabilizationThreshold(threshold: number): void;
        getStabilizationThreshold(): number;
        getRigidDynamicLockFlags(): PxRigidDynamicLockFlags;
        setRigidDynamicLockFlag(flag: PxRigidDynamicLockFlagEnum, value: boolean): void;
        setRigidDynamicLockFlags(flags: PxRigidDynamicLockFlags): void;
        setLinearVelocity(linVel: PxVec3, autowake?: boolean): void;
        setAngularVelocity(angVel: PxVec3, autowake?: boolean): void;
        setWakeCounter(wakeCounterValue: number): void;
        getWakeCounter(): number;
        wakeUp(): void;
        putToSleep(): void;
        setSolverIterationCounts(minPositionIters: number, minVelocityIters?: number): void;
        getContactReportThreshold(): number;
        setContactReportThreshold(threshold: number): void;
    }
    class PxRigidDynamicLockFlags {
        constructor(flags: number);
        isSet(flag: PxRigidDynamicLockFlagEnum): boolean;
        raise(flag: PxRigidDynamicLockFlagEnum): void;
        clear(flag: PxRigidDynamicLockFlagEnum): void;
    }
    class PxRigidStatic extends PxRigidActor {
    }
    class PxSDFDesc {
        constructor();
        isValid(): boolean;
        sdf: PxBoundedData;
        get_sdf(): PxBoundedData;
        set_sdf(value: PxBoundedData): void;
        dims: PxDim3;
        get_dims(): PxDim3;
        set_dims(value: PxDim3): void;
        meshLower: PxVec3;
        get_meshLower(): PxVec3;
        set_meshLower(value: PxVec3): void;
        spacing: number;
        get_spacing(): number;
        set_spacing(value: number): void;
        subgridSize: number;
        get_subgridSize(): number;
        set_subgridSize(value: number): void;
        bitsPerSubgridPixel: PxSdfBitsPerSubgridPixelEnum;
        get_bitsPerSubgridPixel(): PxSdfBitsPerSubgridPixelEnum;
        set_bitsPerSubgridPixel(value: PxSdfBitsPerSubgridPixelEnum): void;
        sdfSubgrids3DTexBlockDim: PxDim3;
        get_sdfSubgrids3DTexBlockDim(): PxDim3;
        set_sdfSubgrids3DTexBlockDim(value: PxDim3): void;
        sdfSubgrids: PxBoundedData;
        get_sdfSubgrids(): PxBoundedData;
        set_sdfSubgrids(value: PxBoundedData): void;
        sdfStartSlots: PxBoundedData;
        get_sdfStartSlots(): PxBoundedData;
        set_sdfStartSlots(value: PxBoundedData): void;
        subgridsMinSdfValue: number;
        get_subgridsMinSdfValue(): number;
        set_subgridsMinSdfValue(value: number): void;
        subgridsMaxSdfValue: number;
        get_subgridsMaxSdfValue(): number;
        set_subgridsMaxSdfValue(value: number): void;
        sdfBounds: PxBounds3;
        get_sdfBounds(): PxBounds3;
        set_sdfBounds(value: PxBounds3): void;
        narrowBandThicknessRelativeToSdfBoundsDiagonal: number;
        get_narrowBandThicknessRelativeToSdfBoundsDiagonal(): number;
        set_narrowBandThicknessRelativeToSdfBoundsDiagonal(value: number): void;
        numThreadsForSdfConstruction: number;
        get_numThreadsForSdfConstruction(): number;
        set_numThreadsForSdfConstruction(value: number): void;
    }
    class PxScene extends PxSceneSQSystem {
        addActor(actor: PxActor, bvh?: PxBVH): boolean;
        removeActor(actor: PxActor, wakeOnLostTouch?: boolean): void;
        addAggregate(aggregate: PxAggregate): boolean;
        removeAggregate(aggregate: PxAggregate, wakeOnLostTouch?: boolean): void;
        addCollection(collection: PxCollection): boolean;
        getWakeCounterResetValue(): number;
        shiftOrigin(shift: PxVec3): void;
        addArticulation(articulation: PxArticulationReducedCoordinate): boolean;
        removeArticulation(articulation: PxArticulationReducedCoordinate, wakeOnLostTouch?: boolean): void;
        getNbActors(types: PxActorTypeFlags): number;
        getNbArticulations(): number;
        getNbConstraints(): number;
        getNbAggregates(): number;
        setDominanceGroupPair(group1: number, group2: number, dominance: PxDominanceGroupPair): void;
        getCpuDispatcher(): PxCpuDispatcher;
        createClient(): number;
        setSimulationEventCallback(callback: PxSimulationEventCallback): void;
        getSimulationEventCallback(): PxSimulationEventCallback;
        setFilterShaderData(data: VoidPtr, dataSize: number): void;
        getFilterShaderData(): VoidPtr;
        getFilterShaderDataSize(): number;
        getFilterShader(): PxSimulationFilterShader;
        resetFiltering(actor: PxActor): boolean;
        getKinematicKinematicFilteringMode(): PxPairFilteringModeEnum;
        getStaticKinematicFilteringMode(): PxPairFilteringModeEnum;
        simulate(elapsedTime: number, completionTask?: PxBaseTask, scratchMemBlock?: VoidPtr, scratchMemBlockSize?: number, controlSimulation?: boolean): boolean;
        advance(completionTask?: PxBaseTask): boolean;
        collide(elapsedTime: number, completionTask?: PxBaseTask, scratchMemBlock?: VoidPtr, scratchMemBlockSize?: number, controlSimulation?: boolean): boolean;
        checkResults(block?: boolean): boolean;
        fetchCollision(block?: boolean): boolean;
        fetchResults(block?: boolean): boolean;
        processCallbacks(continuation: PxBaseTask): void;
        fetchResultsParticleSystem(): void;
        flushSimulation(sendPendingReports?: boolean): void;
        setGravity(vec: PxVec3): void;
        getGravity(): PxVec3;
        setBounceThresholdVelocity(t: number): void;
        getBounceThresholdVelocity(): number;
        setCCDMaxPasses(ccdMaxPasses: number): void;
        getCCDMaxPasses(): number;
        setCCDMaxSeparation(t: number): void;
        getCCDMaxSeparation(): number;
        setCCDThreshold(t: number): void;
        getCCDThreshold(): number;
        setMaxBiasCoefficient(t: number): void;
        getMaxBiasCoefficient(): number;
        setFrictionOffsetThreshold(t: number): void;
        getFrictionOffsetThreshold(): number;
        setFrictionCorrelationDistance(t: number): void;
        getFrictionCorrelationDistance(): number;
        getFrictionType(): PxFrictionTypeEnum;
        getSolverType(): PxSolverTypeEnum;
        getRenderBuffer(): PxRenderBuffer;
        setVisualizationParameter(param: PxVisualizationParameterEnum, value: number): boolean;
        getVisualizationParameter(paramEnum: PxVisualizationParameterEnum): number;
        setVisualizationCullingBox(box: PxBounds3): void;
        getVisualizationCullingBox(): PxBounds3;
        getSimulationStatistics(stats: PxSimulationStatistics): void;
        getBroadPhaseType(): PxBroadPhaseTypeEnum;
        getBroadPhaseCaps(caps: PxBroadPhaseCaps): boolean;
        getNbBroadPhaseRegions(): number;
        getBroadPhaseRegions(userBuffer: PxBroadPhaseRegionInfo, bufferSize: number, startIndex?: number): number;
        addBroadPhaseRegion(region: PxBroadPhaseRegion, populateRegion?: boolean): number;
        removeBroadPhaseRegion(handle: number): boolean;
        lockRead(file?: string, line?: number): void;
        unlockRead(): void;
        lockWrite(file?: string, line?: number): void;
        unlockWrite(): void;
        setNbContactDataBlocks(numBlocks: number): void;
        getNbContactDataBlocksUsed(): number;
        getMaxNbContactDataBlocksUsed(): number;
        getContactReportStreamBufferSize(): number;
        setSolverBatchSize(solverBatchSize: number): void;
        getSolverBatchSize(): number;
        setSolverArticulationBatchSize(solverBatchSize: number): void;
        getSolverArticulationBatchSize(): number;
        release(): void;
        setFlag(flag: PxSceneFlagEnum, value: boolean): void;
        getFlags(): PxSceneFlags;
        setLimits(limits: PxSceneLimits): void;
        getLimits(): PxSceneLimits;
        getPhysics(): PxPhysics;
        getTimestamp(): number;
        getScenePvdClient(): PxPvdSceneClient;
        userData: VoidPtr;
        get_userData(): VoidPtr;
        set_userData(value: VoidPtr): void;
    }
    class PxSceneDesc {
        constructor(scale: PxTolerancesScale);
        setToDefault(scale: PxTolerancesScale): void;
        isValid(): boolean;
        gravity: PxVec3;
        get_gravity(): PxVec3;
        set_gravity(value: PxVec3): void;
        simulationEventCallback: PxSimulationEventCallback;
        get_simulationEventCallback(): PxSimulationEventCallback;
        set_simulationEventCallback(value: PxSimulationEventCallback): void;
        filterShaderData: VoidPtr;
        get_filterShaderData(): VoidPtr;
        set_filterShaderData(value: VoidPtr): void;
        filterShaderDataSize: number;
        get_filterShaderDataSize(): number;
        set_filterShaderDataSize(value: number): void;
        filterShader: PxSimulationFilterShader;
        get_filterShader(): PxSimulationFilterShader;
        set_filterShader(value: PxSimulationFilterShader): void;
        kineKineFilteringMode: PxPairFilteringModeEnum;
        get_kineKineFilteringMode(): PxPairFilteringModeEnum;
        set_kineKineFilteringMode(value: PxPairFilteringModeEnum): void;
        staticKineFilteringMode: PxPairFilteringModeEnum;
        get_staticKineFilteringMode(): PxPairFilteringModeEnum;
        set_staticKineFilteringMode(value: PxPairFilteringModeEnum): void;
        broadPhaseType: PxBroadPhaseTypeEnum;
        get_broadPhaseType(): PxBroadPhaseTypeEnum;
        set_broadPhaseType(value: PxBroadPhaseTypeEnum): void;
        limits: PxSceneLimits;
        get_limits(): PxSceneLimits;
        set_limits(value: PxSceneLimits): void;
        frictionType: PxFrictionTypeEnum;
        get_frictionType(): PxFrictionTypeEnum;
        set_frictionType(value: PxFrictionTypeEnum): void;
        solverType: PxSolverTypeEnum;
        get_solverType(): PxSolverTypeEnum;
        set_solverType(value: PxSolverTypeEnum): void;
        bounceThresholdVelocity: number;
        get_bounceThresholdVelocity(): number;
        set_bounceThresholdVelocity(value: number): void;
        frictionOffsetThreshold: number;
        get_frictionOffsetThreshold(): number;
        set_frictionOffsetThreshold(value: number): void;
        frictionCorrelationDistance: number;
        get_frictionCorrelationDistance(): number;
        set_frictionCorrelationDistance(value: number): void;
        flags: PxSceneFlags;
        get_flags(): PxSceneFlags;
        set_flags(value: PxSceneFlags): void;
        cpuDispatcher: PxCpuDispatcher;
        get_cpuDispatcher(): PxCpuDispatcher;
        set_cpuDispatcher(value: PxCpuDispatcher): void;
        userData: VoidPtr;
        get_userData(): VoidPtr;
        set_userData(value: VoidPtr): void;
        solverBatchSize: number;
        get_solverBatchSize(): number;
        set_solverBatchSize(value: number): void;
        solverArticulationBatchSize: number;
        get_solverArticulationBatchSize(): number;
        set_solverArticulationBatchSize(value: number): void;
        nbContactDataBlocks: number;
        get_nbContactDataBlocks(): number;
        set_nbContactDataBlocks(value: number): void;
        maxNbContactDataBlocks: number;
        get_maxNbContactDataBlocks(): number;
        set_maxNbContactDataBlocks(value: number): void;
        maxBiasCoefficient: number;
        get_maxBiasCoefficient(): number;
        set_maxBiasCoefficient(value: number): void;
        contactReportStreamBufferSize: number;
        get_contactReportStreamBufferSize(): number;
        set_contactReportStreamBufferSize(value: number): void;
        ccdMaxPasses: number;
        get_ccdMaxPasses(): number;
        set_ccdMaxPasses(value: number): void;
        ccdThreshold: number;
        get_ccdThreshold(): number;
        set_ccdThreshold(value: number): void;
        ccdMaxSeparation: number;
        get_ccdMaxSeparation(): number;
        set_ccdMaxSeparation(value: number): void;
        wakeCounterResetValue: number;
        get_wakeCounterResetValue(): number;
        set_wakeCounterResetValue(value: number): void;
        sanityBounds: PxBounds3;
        get_sanityBounds(): PxBounds3;
        set_sanityBounds(value: PxBounds3): void;
        gpuMaxNumPartitions: number;
        get_gpuMaxNumPartitions(): number;
        set_gpuMaxNumPartitions(value: number): void;
        gpuMaxNumStaticPartitions: number;
        get_gpuMaxNumStaticPartitions(): number;
        set_gpuMaxNumStaticPartitions(value: number): void;
        gpuComputeVersion: number;
        get_gpuComputeVersion(): number;
        set_gpuComputeVersion(value: number): void;
        contactPairSlabSize: number;
        get_contactPairSlabSize(): number;
        set_contactPairSlabSize(value: number): void;
        staticStructure: PxPruningStructureTypeEnum;
        get_staticStructure(): PxPruningStructureTypeEnum;
        set_staticStructure(value: PxPruningStructureTypeEnum): void;
        dynamicStructure: PxPruningStructureTypeEnum;
        get_dynamicStructure(): PxPruningStructureTypeEnum;
        set_dynamicStructure(value: PxPruningStructureTypeEnum): void;
        dynamicTreeRebuildRateHint: number;
        get_dynamicTreeRebuildRateHint(): number;
        set_dynamicTreeRebuildRateHint(value: number): void;
        dynamicTreeSecondaryPruner: PxDynamicTreeSecondaryPrunerEnum;
        get_dynamicTreeSecondaryPruner(): PxDynamicTreeSecondaryPrunerEnum;
        set_dynamicTreeSecondaryPruner(value: PxDynamicTreeSecondaryPrunerEnum): void;
        staticBVHBuildStrategy: PxBVHBuildStrategyEnum;
        get_staticBVHBuildStrategy(): PxBVHBuildStrategyEnum;
        set_staticBVHBuildStrategy(value: PxBVHBuildStrategyEnum): void;
        dynamicBVHBuildStrategy: PxBVHBuildStrategyEnum;
        get_dynamicBVHBuildStrategy(): PxBVHBuildStrategyEnum;
        set_dynamicBVHBuildStrategy(value: PxBVHBuildStrategyEnum): void;
        staticNbObjectsPerNode: number;
        get_staticNbObjectsPerNode(): number;
        set_staticNbObjectsPerNode(value: number): void;
        dynamicNbObjectsPerNode: number;
        get_dynamicNbObjectsPerNode(): number;
        set_dynamicNbObjectsPerNode(value: number): void;
        sceneQueryUpdateMode: PxSceneQueryUpdateModeEnum;
        get_sceneQueryUpdateMode(): PxSceneQueryUpdateModeEnum;
        set_sceneQueryUpdateMode(value: PxSceneQueryUpdateModeEnum): void;
    }
    class PxSceneFlags {
        constructor(flags: number);
        isSet(flag: PxSceneFlagEnum): boolean;
        raise(flag: PxSceneFlagEnum): void;
        clear(flag: PxSceneFlagEnum): void;
    }
    class PxSceneLimits {
        constructor();
        setToDefault(): void;
        isValid(): boolean;
        maxNbActors: number;
        get_maxNbActors(): number;
        set_maxNbActors(value: number): void;
        maxNbBodies: number;
        get_maxNbBodies(): number;
        set_maxNbBodies(value: number): void;
        maxNbStaticShapes: number;
        get_maxNbStaticShapes(): number;
        set_maxNbStaticShapes(value: number): void;
        maxNbDynamicShapes: number;
        get_maxNbDynamicShapes(): number;
        set_maxNbDynamicShapes(value: number): void;
        maxNbAggregates: number;
        get_maxNbAggregates(): number;
        set_maxNbAggregates(value: number): void;
        maxNbConstraints: number;
        get_maxNbConstraints(): number;
        set_maxNbConstraints(value: number): void;
        maxNbRegions: number;
        get_maxNbRegions(): number;
        set_maxNbRegions(value: number): void;
        maxNbBroadPhaseOverlaps: number;
        get_maxNbBroadPhaseOverlaps(): number;
        set_maxNbBroadPhaseOverlaps(value: number): void;
    }
    class PxSceneQuerySystemBase {
        setDynamicTreeRebuildRateHint(dynamicTreeRebuildRateHint: number): void;
        getDynamicTreeRebuildRateHint(): number;
        forceRebuildDynamicTree(prunerIndex: number): void;
        setUpdateMode(updateMode: PxSceneQueryUpdateModeEnum): void;
        getUpdateMode(): PxSceneQueryUpdateModeEnum;
        getStaticTimestamp(): number;
        flushUpdates(): void;
        raycast(origin: PxVec3, unitDir: PxVec3, distance: number, hitCall: PxRaycastCallback, hitFlags?: PxHitFlags, filterData?: PxQueryFilterData): boolean;
        sweep(geometry: PxGeometry, pose: PxTransform, unitDir: PxVec3, distance: number, hitCall: PxSweepCallback, hitFlags?: PxHitFlags, filterData?: PxQueryFilterData): boolean;
        overlap(geometry: PxGeometry, pose: PxTransform, hitCall: PxOverlapCallback, filterData?: PxQueryFilterData): boolean;
    }
    class PxSceneSQSystem extends PxSceneQuerySystemBase {
        setSceneQueryUpdateMode(updateMode: PxSceneQueryUpdateModeEnum): void;
        getSceneQueryUpdateMode(): PxSceneQueryUpdateModeEnum;
        getSceneQueryStaticTimestamp(): number;
        flushQueryUpdates(): void;
        forceDynamicTreeRebuild(rebuildStaticStructure: boolean, rebuildDynamicStructure: boolean): void;
        getStaticStructure(): PxPruningStructureTypeEnum;
        getDynamicStructure(): PxPruningStructureTypeEnum;
        sceneQueriesUpdate(completionTask?: PxBaseTask, controlSimulation?: boolean): void;
        checkQueries(block?: boolean): boolean;
        fetchQueries(block?: boolean): boolean;
    }
    class PxSerialization {
        static isSerializable(collection: PxCollection, sr: PxSerializationRegistry, externalReferences?: PxCollection): boolean;
        static complete(collection: PxCollection, sr: PxSerializationRegistry, exceptFor?: PxCollection, followJoints?: boolean): void;
        static createSerialObjectIds(collection: PxCollection, base: number): void;
        static createCollectionFromXml(inputData: PxInputData, params: PxCookingParams, sr: PxSerializationRegistry, externalRefs?: PxCollection): PxCollection;
        static createCollectionFromBinary(memBlock: VoidPtr, sr: PxSerializationRegistry, externalRefs?: PxCollection): PxCollection;
        static serializeCollectionToXml(outputStream: PxOutputStream, collection: PxCollection, sr: PxSerializationRegistry, params?: PxCookingParams, externalRefs?: PxCollection): boolean;
        static serializeCollectionToBinary(outputStream: PxOutputStream, collection: PxCollection, sr: PxSerializationRegistry, externalRefs?: PxCollection, exportNames?: boolean): boolean;
        static createSerializationRegistry(physics: PxPhysics): PxSerializationRegistry;
    }
    class PxSerializationRegistry {
        release(): void;
    }
    class PxShape extends PxRefCounted {
        setGeometry(geometry: PxGeometry): void;
        getGeometry(): PxGeometry;
        getActor(): PxRigidActor;
        setMaterials(materials: PxMaterialPtr, materialCount: number): void;
        getNbMaterials(): number;
        getMaterials(userBuffer: PxMaterialPtr, bufferSize: number, startIndex: number): number;
        getMaterialFromInternalFaceIndex(faceIndex: number): PxBaseMaterial;
        setContactOffset(contactOffset: number): void;
        getContactOffset(): number;
        setRestOffset(restOffset: number): void;
        getRestOffset(): number;
        setTorsionalPatchRadius(radius: number): void;
        getTorsionalPatchRadius(): number;
        setMinTorsionalPatchRadius(radius: number): void;
        getMinTorsionalPatchRadius(): number;
        setFlag(flag: PxShapeFlagEnum, value: boolean): void;
        setFlags(inFlags: PxShapeFlags): void;
        getFlags(): PxShapeFlags;
        isExclusive(): boolean;
        setName(name: string): void;
        getName(): string;
        setLocalPose(pose: PxTransform): void;
        getLocalPose(): PxTransform;
        setSimulationFilterData(data: PxFilterData): void;
        getSimulationFilterData(): PxFilterData;
        setQueryFilterData(data: PxFilterData): void;
        getQueryFilterData(): PxFilterData;
        userData: VoidPtr;
        get_userData(): VoidPtr;
        set_userData(value: VoidPtr): void;
    }
    class PxShapeExt {
        static getGlobalPose(shape: PxShape, actor: PxRigidActor): PxTransform;
        static raycast(shape: PxShape, actor: PxRigidActor, rayOrigin: PxVec3, rayDir: PxVec3, maxDist: number, hitFlags: PxHitFlags, maxHits: number, rayHits: PxRaycastHit): number;
        static overlap(shape: PxShape, actor: PxRigidActor, otherGeom: PxGeometry, otherGeomPose: PxTransform): boolean;
        static sweep(shape: PxShape, actor: PxRigidActor, unitDir: PxVec3, distance: number, otherGeom: PxGeometry, otherGeomPose: PxTransform, sweepHit: PxSweepHit, hitFlags: PxHitFlags): boolean;
        static getWorldBounds(shape: PxShape, actor: PxRigidActor, inflation?: number): PxBounds3;
    }
    class PxShapeFlags {
        constructor(flags: number);
        isSet(flag: PxShapeFlagEnum): boolean;
        raise(flag: PxShapeFlagEnum): void;
        clear(flag: PxShapeFlagEnum): void;
    }
    class PxShapePtr {
    }
    class PxSimpleTriangleMesh {
        constructor();
        setToDefault(): void;
        isValid(): boolean;
        points: PxBoundedData;
        get_points(): PxBoundedData;
        set_points(value: PxBoundedData): void;
        triangles: PxBoundedData;
        get_triangles(): PxBoundedData;
        set_triangles(value: PxBoundedData): void;
        flags: PxMeshFlags;
        get_flags(): PxMeshFlags;
        set_flags(value: PxMeshFlags): void;
    }
    class PxSimulationEventCallback {
    }
    class PxSimulationEventCallbackImpl {
        constructor();
        onConstraintBreak(constraints: PxConstraintInfo, count: number): void;
        onWake(actors: PxActorPtr, count: number): void;
        onSleep(actors: PxActorPtr, count: number): void;
        onContact(pairHeader: PxContactPairHeader, pairs: PxContactPair, nbPairs: number): void;
        onTrigger(pairs: PxTriggerPair, count: number): void;
    }
    class PxSimulationFilterShader {
    }
    class PxSimulationStatistics {
        nbActiveConstraints: number;
        get_nbActiveConstraints(): number;
        set_nbActiveConstraints(value: number): void;
        nbActiveDynamicBodies: number;
        get_nbActiveDynamicBodies(): number;
        set_nbActiveDynamicBodies(value: number): void;
        nbActiveKinematicBodies: number;
        get_nbActiveKinematicBodies(): number;
        set_nbActiveKinematicBodies(value: number): void;
        nbStaticBodies: number;
        get_nbStaticBodies(): number;
        set_nbStaticBodies(value: number): void;
        nbDynamicBodies: number;
        get_nbDynamicBodies(): number;
        set_nbDynamicBodies(value: number): void;
        nbKinematicBodies: number;
        get_nbKinematicBodies(): number;
        set_nbKinematicBodies(value: number): void;
        nbShapes: ReadonlyArray<number>;
        get_nbShapes(): ReadonlyArray<number>;
        set_nbShapes(value: ReadonlyArray<number>): void;
        nbAggregates: number;
        get_nbAggregates(): number;
        set_nbAggregates(value: number): void;
        nbArticulations: number;
        get_nbArticulations(): number;
        set_nbArticulations(value: number): void;
        nbAxisSolverConstraints: number;
        get_nbAxisSolverConstraints(): number;
        set_nbAxisSolverConstraints(value: number): void;
        compressedContactSize: number;
        get_compressedContactSize(): number;
        set_compressedContactSize(value: number): void;
        requiredContactConstraintMemory: number;
        get_requiredContactConstraintMemory(): number;
        set_requiredContactConstraintMemory(value: number): void;
        peakConstraintMemory: number;
        get_peakConstraintMemory(): number;
        set_peakConstraintMemory(value: number): void;
        nbDiscreteContactPairsTotal: number;
        get_nbDiscreteContactPairsTotal(): number;
        set_nbDiscreteContactPairsTotal(value: number): void;
        nbDiscreteContactPairsWithCacheHits: number;
        get_nbDiscreteContactPairsWithCacheHits(): number;
        set_nbDiscreteContactPairsWithCacheHits(value: number): void;
        nbDiscreteContactPairsWithContacts: number;
        get_nbDiscreteContactPairsWithContacts(): number;
        set_nbDiscreteContactPairsWithContacts(value: number): void;
        nbNewPairs: number;
        get_nbNewPairs(): number;
        set_nbNewPairs(value: number): void;
        nbLostPairs: number;
        get_nbLostPairs(): number;
        set_nbLostPairs(value: number): void;
        nbNewTouches: number;
        get_nbNewTouches(): number;
        set_nbNewTouches(value: number): void;
        nbLostTouches: number;
        get_nbLostTouches(): number;
        set_nbLostTouches(value: number): void;
        nbPartitions: number;
        get_nbPartitions(): number;
        set_nbPartitions(value: number): void;
        nbBroadPhaseAdds: number;
        get_nbBroadPhaseAdds(): number;
        set_nbBroadPhaseAdds(value: number): void;
        nbBroadPhaseRemoves: number;
        get_nbBroadPhaseRemoves(): number;
        set_nbBroadPhaseRemoves(value: number): void;
    }
    class PxSpatialForce {
        force: PxVec3;
        get_force(): PxVec3;
        set_force(value: PxVec3): void;
        torque: PxVec3;
        get_torque(): PxVec3;
        set_torque(value: PxVec3): void;
    }
    class PxSpatialVelocity {
        linear: PxVec3;
        get_linear(): PxVec3;
        set_linear(value: PxVec3): void;
        angular: PxVec3;
        get_angular(): PxVec3;
        set_angular(value: PxVec3): void;
    }
    class PxSphereGeometry extends PxGeometry {
        constructor(ir: number);
        radius: number;
        get_radius(): number;
        set_radius(value: number): void;
    }
    class PxSphericalJoint extends PxJoint {
        setLimitCone(limitCone: PxJointLimitCone): void;
        getSwingYAngle(): number;
        getSwingZAngle(): number;
        setSphericalJointFlags(flags: PxSphericalJointFlags): void;
        setSphericalJointFlag(flag: PxSphericalJointFlagEnum, value: boolean): void;
        getSphericalJointFlags(): PxSphericalJointFlags;
    }
    class PxSphericalJointFlags {
        constructor(flags: number);
        isSet(flag: PxSphericalJointFlagEnum): boolean;
        raise(flag: PxSphericalJointFlagEnum): void;
        clear(flag: PxSphericalJointFlagEnum): void;
    }
    class PxSpring {
        constructor(stiffness: number, damping: number);
        stiffness: number;
        get_stiffness(): number;
        set_stiffness(value: number): void;
        damping: number;
        get_damping(): number;
        set_damping(value: number): void;
    }
    class PxStridedData {
        stride: number;
        get_stride(): number;
        set_stride(value: number): void;
        data: VoidPtr;
        get_data(): VoidPtr;
        set_data(value: VoidPtr): void;
    }
    class PxSweepBuffer10 extends PxSweepCallback {
        constructor();
        getNbAnyHits(): number;
        getAnyHit(index: number): PxSweepHit;
        getNbTouches(): number;
        getTouches(): PxSweepHit;
        getTouch(index: number): PxSweepHit;
        getMaxNbTouches(): number;
        block: PxSweepHit;
        get_block(): PxSweepHit;
        set_block(value: PxSweepHit): void;
        hasBlock: boolean;
        get_hasBlock(): boolean;
        set_hasBlock(value: boolean): void;
    }
    class PxSweepCallback {
        hasAnyHits(): boolean;
    }
    class PxSweepHit extends PxGeomSweepHit {
        constructor();
        actor: PxRigidActor;
        get_actor(): PxRigidActor;
        set_actor(value: PxRigidActor): void;
        shape: PxShape;
        get_shape(): PxShape;
        set_shape(value: PxShape): void;
    }
    class PxSweepResult extends PxSweepCallback {
        constructor();
        getNbAnyHits(): number;
        getAnyHit(index: number): PxSweepHit;
        getNbTouches(): number;
        getTouch(index: number): PxSweepHit;
        clear(): void;
        block: PxSweepHit;
        get_block(): PxSweepHit;
        set_block(value: PxSweepHit): void;
        hasBlock: boolean;
        get_hasBlock(): boolean;
        set_hasBlock(value: boolean): void;
    }
    class PxTetMaker {
        static createConformingTetrahedronMesh(triangleMesh: PxSimpleTriangleMesh, outVertices: PxArray_PxVec3, outTetIndices: PxArray_PxU32, validate: boolean, volumeThreshold: number): boolean;
        static createVoxelTetrahedronMesh(tetMesh: PxTetrahedronMeshDesc, numVoxelsAlongLongestBoundingBoxAxis: number, outVertices: PxArray_PxVec3, outTetIndices: PxArray_PxU32): boolean;
        static createVoxelTetrahedronMeshFromEdgeLength(tetMesh: PxTetrahedronMeshDesc, voxelEdgeLength: number, outVertices: PxArray_PxVec3, outTetIndices: PxArray_PxU32): boolean;
        static validateTriangleMesh(triangleMesh: PxSimpleTriangleMesh, minVolumeThreshold: number, minTriangleAngleRadians: number): PxTriangleMeshAnalysisResults;
        static validateTetrahedronMesh(points: PxBoundedData, tetrahedra: PxBoundedData, minTetVolumeThreshold: number): PxTetrahedronMeshAnalysisResults;
        static simplifyTriangleMesh(inputVertices: PxArray_PxVec3, inputIndices: PxArray_PxU32, targetTriangleCount: number, maximalEdgeLength: number, outputVertices: PxArray_PxVec3, outputIndices: PxArray_PxU32, vertexMap?: PxArray_PxU32, edgeLengthCostWeight?: number, flatnessDetectionThreshold?: number, projectSimplifiedPointsOnInputMeshSurface?: boolean, outputVertexToInputTriangle?: PxArray_PxU32, removeDisconnectedPatches?: boolean): void;
        static remeshTriangleMesh(inputVertices: PxArray_PxVec3, inputIndices: PxArray_PxU32, gridResolution: number, outputVertices: PxArray_PxVec3, outputIndices: PxArray_PxU32, vertexMap?: PxArray_PxU32): void;
        static createTreeBasedTetrahedralMesh(inputVertices: PxArray_PxVec3, inputIndices: PxArray_PxU32, useTreeNodes: boolean, outputVertices: PxArray_PxVec3, outputIndices: PxArray_PxU32, volumeThreshold: number): void;
        static createRelaxedVoxelTetrahedralMesh(inputVertices: PxArray_PxVec3, inputIndices: PxArray_PxU32, outputVertices: PxArray_PxVec3, outputIndices: PxArray_PxU32, resolution: number, numRelaxationIterations?: number, relMinTetVolume?: number): void;
        static detectTriangleIslands(triangles: PxI32ConstPtr, numTriangles: number, islandIndexPerTriangle: PxArray_PxU32): void;
        static findLargestIslandId(islandIndexPerTriangle: PxU32ConstPtr, numTriangles: number): number;
    }
    class PxTetrahedronMesh extends PxRefCounted {
        getNbVertices(): number;
        getVertices(): PxVec3;
        getNbTetrahedrons(): number;
        getTetrahedrons(): VoidPtr;
        getTetrahedronMeshFlags(): PxTetrahedronMeshFlags;
        getTetrahedraRemap(): PxU32ConstPtr;
        getLocalBounds(): PxBounds3;
    }
    class PxTetrahedronMeshAnalysisResults {
        constructor(flags: number);
        isSet(flag: PxTetrahedronMeshAnalysisResultEnum): boolean;
        raise(flag: PxTetrahedronMeshAnalysisResultEnum): void;
        clear(flag: PxTetrahedronMeshAnalysisResultEnum): void;
    }
    class PxTetrahedronMeshDesc {
        constructor();
        constructor(meshVertices: PxArray_PxVec3, meshTetIndices: PxArray_PxU32, meshFormat?: PxTetrahedronMeshFormatEnum, numberOfTetsPerHexElement?: number);
        isValid(): boolean;
        materialIndices: PxTypedBoundedData_PxU16;
        get_materialIndices(): PxTypedBoundedData_PxU16;
        set_materialIndices(value: PxTypedBoundedData_PxU16): void;
        points: PxBoundedData;
        get_points(): PxBoundedData;
        set_points(value: PxBoundedData): void;
        tetrahedrons: PxBoundedData;
        get_tetrahedrons(): PxBoundedData;
        set_tetrahedrons(value: PxBoundedData): void;
        flags: PxMeshFlags;
        get_flags(): PxMeshFlags;
        set_flags(value: PxMeshFlags): void;
        tetsPerElement: number;
        get_tetsPerElement(): number;
        set_tetsPerElement(value: number): void;
    }
    class PxTetrahedronMeshExt {
        static findTetrahedronContainingPoint(mesh: PxTetrahedronMesh, point: PxVec3, bary: PxVec4, tolerance: number): number;
        static findTetrahedronClosestToPoint(mesh: PxTetrahedronMesh, point: PxVec3, bary: PxVec4): number;
        static createPointsToTetrahedronMap(tetMeshVertices: PxArray_PxVec3, tetMeshIndices: PxArray_PxU32, pointsToEmbed: PxArray_PxVec3, barycentricCoordinates: PxArray_PxVec4, tetLinks: PxArray_PxU32): void;
        static extractTetMeshSurface(mesh: PxTetrahedronMesh, surfaceTriangles: PxArray_PxU32, surfaceTriangleToTet?: PxArray_PxU32, flipTriangleOrientation?: boolean): void;
    }
    class PxTetrahedronMeshFlags {
        constructor(flags: number);
        isSet(flag: PxTetrahedronMeshFlagEnum): boolean;
        raise(flag: PxTetrahedronMeshFlagEnum): void;
        clear(flag: PxTetrahedronMeshFlagEnum): void;
    }
    class PxTetrahedronMeshGeometry extends PxGeometry {
        constructor(mesh: PxTetrahedronMesh);
        isValid(): boolean;
        tetrahedronMesh: PxTetrahedronMesh;
        get_tetrahedronMesh(): PxTetrahedronMesh;
        set_tetrahedronMesh(value: PxTetrahedronMesh): void;
    }
    class PxTolerancesScale {
        constructor();
        isValid(): boolean;
        length: number;
        get_length(): number;
        set_length(value: number): void;
        speed: number;
        get_speed(): number;
        set_speed(value: number): void;
    }
    class PxTopLevelFunctions {
        static DefaultFilterShader(): PxSimulationFilterShader;
        static setupPassThroughFilterShader(sceneDesc: PxSceneDesc, filterShader: PassThroughFilterShader): void;
        static CreateControllerManager(scene: PxScene, lockingEnabled?: boolean): PxControllerManager;
        static CreateFoundation(version: number, allocator: PxDefaultAllocator, errorCallback: PxErrorCallback): PxFoundation;
        static CreatePhysics(version: number, foundation: PxFoundation, params: PxTolerancesScale, pvd?: PxPvd, omniPvd?: PxOmniPvd): PxPhysics;
        static DefaultCpuDispatcherCreate(numThreads: number): PxDefaultCpuDispatcher;
        static InitExtensions(physics: PxPhysics): boolean;
        static CloseExtensions(): void;
        static CreatePvd(foundation: PxFoundation): PxPvd;
        static D6JointCreate(physics: PxPhysics, actor0: PxRigidActor, localFrame0: PxTransform, actor1: PxRigidActor, localFrame1: PxTransform): PxD6Joint;
        static DistanceJointCreate(physics: PxPhysics, actor0: PxRigidActor, localFrame0: PxTransform, actor1: PxRigidActor, localFrame1: PxTransform): PxDistanceJoint;
        static FixedJointCreate(physics: PxPhysics, actor0: PxRigidActor, localFrame0: PxTransform, actor1: PxRigidActor, localFrame1: PxTransform): PxFixedJoint;
        static GearJointCreate(physics: PxPhysics, actor0: PxRigidActor, localFrame0: PxTransform, actor1: PxRigidActor, localFrame1: PxTransform): PxGearJoint;
        static PrismaticJointCreate(physics: PxPhysics, actor0: PxRigidActor, localFrame0: PxTransform, actor1: PxRigidActor, localFrame1: PxTransform): PxPrismaticJoint;
        static RackAndPinionJointCreate(physics: PxPhysics, actor0: PxRigidActor, localFrame0: PxTransform, actor1: PxRigidActor, localFrame1: PxTransform): PxRackAndPinionJoint;
        static RevoluteJointCreate(physics: PxPhysics, actor0: PxRigidActor, localFrame0: PxTransform, actor1: PxRigidActor, localFrame1: PxTransform): PxRevoluteJoint;
        static SphericalJointCreate(physics: PxPhysics, actor0: PxRigidActor, localFrame0: PxTransform, actor1: PxRigidActor, localFrame1: PxTransform): PxSphericalJoint;
        static CreateConvexMesh(params: PxCookingParams, desc: PxConvexMeshDesc): PxConvexMesh;
        static CreateTriangleMesh(params: PxCookingParams, desc: PxTriangleMeshDesc): PxTriangleMesh;
        static CreateHeightField(desc: PxHeightFieldDesc): PxHeightField;
        static CookTriangleMesh(params: PxCookingParams, desc: PxTriangleMeshDesc, stream: PxOutputStream): boolean;
        static CookConvexMesh(params: PxCookingParams, desc: PxConvexMeshDesc, stream: PxOutputStream): boolean;
        static CreateDynamicFromShape(sdk: PxPhysics, transform: PxTransform, shape: PxShape, density: number): PxRigidDynamic;
        static CreateDynamic(sdk: PxPhysics, transform: PxTransform, geometry: PxGeometry, material: PxMaterial, density: number, shapeOffset?: PxTransform): PxRigidDynamic;
        static CreateKinematicFromShape(sdk: PxPhysics, transform: PxTransform, shape: PxShape, density: number): PxRigidDynamic;
        static CreateKinematic(sdk: PxPhysics, transform: PxTransform, geometry: PxGeometry, material: PxMaterial, density: number, shapeOffset?: PxTransform): PxRigidDynamic;
        static CreateStaticFromShape(sdk: PxPhysics, transform: PxTransform, shape: PxShape): PxRigidStatic;
        static CreateStatic(sdk: PxPhysics, transform: PxTransform, geometry: PxGeometry, material: PxMaterial, shapeOffset: PxTransform): PxRigidStatic;
        static CreatePlane(sdk: PxPhysics, plane: PxPlane, material: PxMaterial): PxRigidStatic;
        static CloneShape(physics: PxPhysics, from: PxShape, isExclusive: boolean): PxShape;
        static CloneStatic(physicsSDK: PxPhysics, transform: PxTransform, from: PxRigidActor): PxRigidStatic;
        static CloneDynamic(physicsSDK: PxPhysics, transform: PxTransform, from: PxRigidDynamic): PxRigidDynamic;
        static ScaleRigidActor(actor: PxRigidActor, scale: number, scaleMassProps: boolean): void;
        static IntegrateTransform(curTrans: PxTransform, linvel: PxVec3, angvel: PxVec3, timeStep: number, result: PxTransform): void;
        static GetTriangleMeshSDFDimensions(mesh: PxTriangleMesh): PxDim3;
        static readonly PHYSICS_VERSION: number;
        static get_PHYSICS_VERSION(): number;
    }
    class PxTransform {
        constructor();
        constructor(r: PxIDENTITYEnum);
        constructor(p0: PxVec3, q0: PxQuat);
        getInverse(): PxTransform;
        transform(input: PxVec3): PxVec3;
        transformInv(input: PxVec3): PxVec3;
        isValid(): boolean;
        isSane(): boolean;
        isFinite(): boolean;
        getNormalized(): PxTransform;
        q: PxQuat;
        get_q(): PxQuat;
        set_q(value: PxQuat): void;
        p: PxVec3;
        get_p(): PxVec3;
        set_p(value: PxVec3): void;
    }
    class PxTriangle {
        constructor();
        constructor(p0: PxVec3, p1: PxVec3, p2: PxVec3);
        normal(normal: PxVec3): void;
        denormalizedNormal(normal: PxVec3): void;
        area(): number;
        pointFromUV(u: number, v: number): PxVec3;
    }
    class PxTriangleMesh extends PxRefCounted {
        getNbVertices(): number;
        getVertices(): PxVec3;
        getVerticesForModification(): PxVec3;
        refitBVH(): PxBounds3;
        getNbTriangles(): number;
        getTriangles(): VoidPtr;
        getTriangleMeshFlags(): PxTriangleMeshFlags;
        getTrianglesRemap(): PxU32ConstPtr;
        getTriangleMaterialIndex(triangleIndex: number): number;
        getLocalBounds(): PxBounds3;
        getSDF(): PxRealConstPtr;
        setPreferSDFProjection(prefer: boolean): void;
    }
    class PxTriangleMeshAnalysisResults {
        constructor(flags: number);
        isSet(flag: PxTriangleMeshAnalysisResultEnum): boolean;
        raise(flag: PxTriangleMeshAnalysisResultEnum): void;
        clear(flag: PxTriangleMeshAnalysisResultEnum): void;
    }
    class PxTriangleMeshDesc extends PxSimpleTriangleMesh {
        constructor();
        materialIndices: PxTypedBoundedData_PxU16Const;
        get_materialIndices(): PxTypedBoundedData_PxU16Const;
        set_materialIndices(value: PxTypedBoundedData_PxU16Const): void;
        sdfDesc: PxSDFDesc;
        get_sdfDesc(): PxSDFDesc;
        set_sdfDesc(value: PxSDFDesc): void;
    }
    class PxTriangleMeshFlags {
        constructor(flags: number);
        isSet(flag: PxTriangleMeshFlagEnum): boolean;
        raise(flag: PxTriangleMeshFlagEnum): void;
        clear(flag: PxTriangleMeshFlagEnum): void;
    }
    class PxTriangleMeshGeometry extends PxGeometry {
        constructor(mesh: PxTriangleMesh, scaling?: PxMeshScale, flags?: PxMeshGeometryFlags);
        isValid(): boolean;
        scale: PxMeshScale;
        get_scale(): PxMeshScale;
        set_scale(value: PxMeshScale): void;
        meshFlags: PxMeshGeometryFlags;
        get_meshFlags(): PxMeshGeometryFlags;
        set_meshFlags(value: PxMeshGeometryFlags): void;
        triangleMesh: PxTriangleMesh;
        get_triangleMesh(): PxTriangleMesh;
        set_triangleMesh(value: PxTriangleMesh): void;
    }
    class PxTriggerPair {
        triggerShape: PxShape;
        get_triggerShape(): PxShape;
        set_triggerShape(value: PxShape): void;
        triggerActor: PxActor;
        get_triggerActor(): PxActor;
        set_triggerActor(value: PxActor): void;
        otherShape: PxShape;
        get_otherShape(): PxShape;
        set_otherShape(value: PxShape): void;
        otherActor: PxActor;
        get_otherActor(): PxActor;
        set_otherActor(value: PxActor): void;
        status: PxPairFlagEnum;
        get_status(): PxPairFlagEnum;
        set_status(value: PxPairFlagEnum): void;
        flags: PxTriggerPairFlags;
        get_flags(): PxTriggerPairFlags;
        set_flags(value: PxTriggerPairFlags): void;
    }
    class PxTriggerPairFlags {
        constructor(flags: number);
        isSet(flag: PxTriggerPairFlagEnum): boolean;
        raise(flag: PxTriggerPairFlagEnum): void;
        clear(flag: PxTriggerPairFlagEnum): void;
    }
    class PxTypedBoundedData_PxU16 {
        stride: number;
        get_stride(): number;
        set_stride(value: number): void;
        data: PxU16Ptr;
        get_data(): PxU16Ptr;
        set_data(value: PxU16Ptr): void;
    }
    class PxTypedBoundedData_PxU16Const {
        stride: number;
        get_stride(): number;
        set_stride(value: number): void;
        data: PxU16ConstPtr;
        get_data(): PxU16ConstPtr;
        set_data(value: PxU16ConstPtr): void;
    }
    class PxU16ConstPtr {
    }
    class PxU16Ptr extends PxU16ConstPtr {
    }
    class PxU32ConstPtr {
    }
    class PxU32Ptr extends PxU32ConstPtr {
    }
    class PxU8ConstPtr {
    }
    class PxU8Ptr extends PxU8ConstPtr {
    }
    class PxUserControllerHitReport {
        onShapeHit(hit: PxControllerShapeHit): void;
        onControllerHit(hit: PxControllersHit): void;
        onObstacleHit(hit: PxControllerObstacleHit): void;
    }
    class PxUserControllerHitReportImpl {
        constructor();
        onShapeHit(hit: PxControllerShapeHit): void;
        onControllerHit(hit: PxControllersHit): void;
        onObstacleHit(hit: PxControllerObstacleHit): void;
    }
    class PxVec3 {
        constructor();
        constructor(x: number, y: number, z: number);
        isZero(): boolean;
        isFinite(): boolean;
        isNormalized(): boolean;
        magnitudeSquared(): number;
        magnitude(): number;
        dot(v: PxVec3): number;
        cross(v: PxVec3): PxVec3;
        getNormalized(): PxVec3;
        normalize(): number;
        normalizeSafe(): number;
        normalizeFast(): number;
        multiply(a: PxVec3): PxVec3;
        minimum(v: PxVec3): PxVec3;
        minElement(): number;
        maximum(v: PxVec3): PxVec3;
        maxElement(): number;
        abs(): PxVec3;
        x: number;
        get_x(): number;
        set_x(value: number): void;
        y: number;
        get_y(): number;
        set_y(value: number): void;
        z: number;
        get_z(): number;
        set_z(value: number): void;
    }
    class PxVec4 {
        constructor();
        constructor(x: number, y: number, z: number, w: number);
        isZero(): boolean;
        isFinite(): boolean;
        isNormalized(): boolean;
        magnitudeSquared(): number;
        magnitude(): number;
        dot(v: PxVec4): number;
        getNormalized(): PxVec4;
        normalize(): number;
        multiply(a: PxVec4): PxVec4;
        minimum(v: PxVec4): PxVec4;
        maximum(v: PxVec4): PxVec4;
        getXYZ(): PxVec3;
        x: number;
        get_x(): number;
        set_x(value: number): void;
        y: number;
        get_y(): number;
        set_y(value: number): void;
        z: number;
        get_z(): number;
        set_z(value: number): void;
        w: number;
        get_w(): number;
        set_w(value: number): void;
    }
    class PxVehicleAckermannParams {
        constructor();
        isValid(axleDesc: PxVehicleAxleDescription): boolean;
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleAckermannParams;
        wheelIds: ReadonlyArray<number>;
        get_wheelIds(): ReadonlyArray<number>;
        set_wheelIds(value: ReadonlyArray<number>): void;
        wheelBase: number;
        get_wheelBase(): number;
        set_wheelBase(value: number): void;
        trackWidth: number;
        get_trackWidth(): number;
        set_trackWidth(value: number): void;
        strength: number;
        get_strength(): number;
        set_strength(value: number): void;
    }
    class PxVehicleAntiRollForceParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleAntiRollForceParams;
        isValid(axleDesc: PxVehicleAxleDescription): boolean;
        wheel0: number;
        get_wheel0(): number;
        set_wheel0(value: number): void;
        wheel1: number;
        get_wheel1(): number;
        set_wheel1(value: number): void;
        stiffness: number;
        get_stiffness(): number;
        set_stiffness(value: number): void;
    }
    class PxVehicleAntiRollTorque {
        constructor();
        setToDefault(): void;
        antiRollTorque: PxVec3;
        get_antiRollTorque(): PxVec3;
        set_antiRollTorque(value: PxVec3): void;
    }
    class PxVehicleAutoboxParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleAutoboxParams;
        isValid(gearboxParams: PxVehicleGearboxParams): boolean;
        upRatios: ReadonlyArray<number>;
        get_upRatios(): ReadonlyArray<number>;
        set_upRatios(value: ReadonlyArray<number>): void;
        downRatios: ReadonlyArray<number>;
        get_downRatios(): ReadonlyArray<number>;
        set_downRatios(value: ReadonlyArray<number>): void;
        latency: number;
        get_latency(): number;
        set_latency(value: number): void;
    }
    class PxVehicleAutoboxState {
        constructor();
        setToDefault(): void;
        timeSinceLastShift: number;
        get_timeSinceLastShift(): number;
        set_timeSinceLastShift(value: number): void;
        activeAutoboxGearShift: boolean;
        get_activeAutoboxGearShift(): boolean;
        set_activeAutoboxGearShift(value: boolean): void;
    }
    class PxVehicleAxleDescription {
        constructor();
        setToDefault(): void;
        getNbWheelsOnAxle(i: number): number;
        getWheelOnAxle(j: number, i: number): number;
        getAxle(wheelId: number): number;
        isValid(): boolean;
        nbAxles: number;
        get_nbAxles(): number;
        set_nbAxles(value: number): void;
        nbWheelsPerAxle: ReadonlyArray<number>;
        get_nbWheelsPerAxle(): ReadonlyArray<number>;
        set_nbWheelsPerAxle(value: ReadonlyArray<number>): void;
        axleToWheelIds: ReadonlyArray<number>;
        get_axleToWheelIds(): ReadonlyArray<number>;
        set_axleToWheelIds(value: ReadonlyArray<number>): void;
        wheelIdsInAxleOrder: ReadonlyArray<number>;
        get_wheelIdsInAxleOrder(): ReadonlyArray<number>;
        set_wheelIdsInAxleOrder(value: ReadonlyArray<number>): void;
        nbWheels: number;
        get_nbWheels(): number;
        set_nbWheels(value: number): void;
    }
    class PxVehicleBrakeCommandResponseParams extends PxVehicleCommandResponseParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleBrakeCommandResponseParams;
        isValid(axleDesc: PxVehicleAxleDescription): boolean;
    }
    class PxVehicleClutchCommandResponseParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleClutchCommandResponseParams;
        isValid(): boolean;
        maxResponse: number;
        get_maxResponse(): number;
        set_maxResponse(value: number): void;
    }
    class PxVehicleClutchCommandResponseState {
        constructor();
        setToDefault(): void;
        normalisedCommandResponse: number;
        get_normalisedCommandResponse(): number;
        set_normalisedCommandResponse(value: number): void;
        commandResponse: number;
        get_commandResponse(): number;
        set_commandResponse(value: number): void;
    }
    class PxVehicleClutchParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleClutchParams;
        isValid(): boolean;
        accuracyMode: PxVehicleClutchAccuracyModeEnum;
        get_accuracyMode(): PxVehicleClutchAccuracyModeEnum;
        set_accuracyMode(value: PxVehicleClutchAccuracyModeEnum): void;
        estimateIterations: number;
        get_estimateIterations(): number;
        set_estimateIterations(value: number): void;
    }
    class PxVehicleClutchSlipState {
        constructor();
        setToDefault(): void;
        clutchSlip: number;
        get_clutchSlip(): number;
        set_clutchSlip(value: number): void;
    }
    class PxVehicleCommandNonLinearResponseParams {
        constructor();
        clear(): void;
        addResponse(commandValueSpeedResponses: PxVehicleCommandValueResponseTable): boolean;
        speedResponses: ReadonlyArray<number>;
        get_speedResponses(): ReadonlyArray<number>;
        set_speedResponses(value: ReadonlyArray<number>): void;
        nbSpeedResponses: number;
        get_nbSpeedResponses(): number;
        set_nbSpeedResponses(value: number): void;
        speedResponsesPerCommandValue: ReadonlyArray<number>;
        get_speedResponsesPerCommandValue(): ReadonlyArray<number>;
        set_speedResponsesPerCommandValue(value: ReadonlyArray<number>): void;
        nbSpeedResponsesPerCommandValue: ReadonlyArray<number>;
        get_nbSpeedResponsesPerCommandValue(): ReadonlyArray<number>;
        set_nbSpeedResponsesPerCommandValue(value: ReadonlyArray<number>): void;
        commandValues: ReadonlyArray<number>;
        get_commandValues(): ReadonlyArray<number>;
        set_commandValues(value: ReadonlyArray<number>): void;
        nbCommandValues: number;
        get_nbCommandValues(): number;
        set_nbCommandValues(value: number): void;
    }
    class PxVehicleCommandResponseParams {
        constructor();
        nonlinearResponse: PxVehicleCommandNonLinearResponseParams;
        get_nonlinearResponse(): PxVehicleCommandNonLinearResponseParams;
        set_nonlinearResponse(value: PxVehicleCommandNonLinearResponseParams): void;
        wheelResponseMultipliers: ReadonlyArray<number>;
        get_wheelResponseMultipliers(): ReadonlyArray<number>;
        set_wheelResponseMultipliers(value: ReadonlyArray<number>): void;
        maxResponse: number;
        get_maxResponse(): number;
        set_maxResponse(value: number): void;
    }
    class PxVehicleCommandState {
        constructor();
        setToDefault(): void;
        brakes: ReadonlyArray<number>;
        get_brakes(): ReadonlyArray<number>;
        set_brakes(value: ReadonlyArray<number>): void;
        nbBrakes: number;
        get_nbBrakes(): number;
        set_nbBrakes(value: number): void;
        throttle: number;
        get_throttle(): number;
        set_throttle(value: number): void;
        steer: number;
        get_steer(): number;
        set_steer(value: number): void;
    }
    class PxVehicleCommandValueResponseTable {
        constructor();
        commandValue: number;
        get_commandValue(): number;
        set_commandValue(value: number): void;
    }
    class PxVehicleComponent {
    }
    class PxVehicleComponentSequence {
        constructor();
        add(component: PxVehicleComponent): boolean;
        beginSubstepGroup(nbSubSteps?: number): number;
        endSubstepGroup(): void;
        setSubsteps(subGroupHandle: number, nbSteps: number): void;
        update(dt: number, context: PxVehicleSimulationContext): void;
    }
    class PxVehicleConstraintConnector extends PxConstraintConnector {
        constructor();
        constructor(vehicleConstraintState: PxVehiclePhysXConstraintState);
        setConstraintState(constraintState: PxVehiclePhysXConstraintState): void;
        getConstantBlock(): void;
    }
    class PxVehicleDifferentialState {
        constructor();
        setToDefault(): void;
        connectedWheels: ReadonlyArray<number>;
        get_connectedWheels(): ReadonlyArray<number>;
        set_connectedWheels(value: ReadonlyArray<number>): void;
        nbConnectedWheels: number;
        get_nbConnectedWheels(): number;
        set_nbConnectedWheels(value: number): void;
        torqueRatiosAllWheels: ReadonlyArray<number>;
        get_torqueRatiosAllWheels(): ReadonlyArray<number>;
        set_torqueRatiosAllWheels(value: ReadonlyArray<number>): void;
        aveWheelSpeedContributionAllWheels: ReadonlyArray<number>;
        get_aveWheelSpeedContributionAllWheels(): ReadonlyArray<number>;
        set_aveWheelSpeedContributionAllWheels(value: ReadonlyArray<number>): void;
    }
    class PxVehicleDirectDriveThrottleCommandResponseParams extends PxVehicleCommandResponseParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleDirectDriveThrottleCommandResponseParams;
        isValid(axleDesc: PxVehicleAxleDescription): boolean;
    }
    class PxVehicleDirectDriveTransmissionCommandState {
        constructor();
        setToDefault(): void;
        gear: PxVehicleDirectDriveTransmissionCommandStateEnum;
        get_gear(): PxVehicleDirectDriveTransmissionCommandStateEnum;
        set_gear(value: PxVehicleDirectDriveTransmissionCommandStateEnum): void;
    }
    class PxVehicleEngineDriveThrottleCommandResponseState {
        constructor();
        setToDefault(): void;
        commandResponse: number;
        get_commandResponse(): number;
        set_commandResponse(value: number): void;
    }
    class PxVehicleEngineDriveTransmissionCommandState {
        constructor();
        setToDefault(): void;
        clutch: number;
        get_clutch(): number;
        set_clutch(value: number): void;
        targetGear: number;
        get_targetGear(): number;
        set_targetGear(value: number): void;
    }
    class PxVehicleEngineParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleEngineParams;
        isValid(): boolean;
        torqueCurve: PxVehicleTorqueCurveLookupTable;
        get_torqueCurve(): PxVehicleTorqueCurveLookupTable;
        set_torqueCurve(value: PxVehicleTorqueCurveLookupTable): void;
        moi: number;
        get_moi(): number;
        set_moi(value: number): void;
        peakTorque: number;
        get_peakTorque(): number;
        set_peakTorque(value: number): void;
        idleOmega: number;
        get_idleOmega(): number;
        set_idleOmega(value: number): void;
        maxOmega: number;
        get_maxOmega(): number;
        set_maxOmega(value: number): void;
        dampingRateFullThrottle: number;
        get_dampingRateFullThrottle(): number;
        set_dampingRateFullThrottle(value: number): void;
        dampingRateZeroThrottleClutchEngaged: number;
        get_dampingRateZeroThrottleClutchEngaged(): number;
        set_dampingRateZeroThrottleClutchEngaged(value: number): void;
        dampingRateZeroThrottleClutchDisengaged: number;
        get_dampingRateZeroThrottleClutchDisengaged(): number;
        set_dampingRateZeroThrottleClutchDisengaged(value: number): void;
    }
    class PxVehicleEngineState {
        constructor();
        setToDefault(): void;
        rotationSpeed: number;
        get_rotationSpeed(): number;
        set_rotationSpeed(value: number): void;
    }
    class PxVehicleFixedSizeLookupTableFloat_3 {
        constructor();
        addPair(x: number, y: number): boolean;
        interpolate(x: number): number;
        clear(): void;
        isValid(): boolean;
    }
    class PxVehicleFixedSizeLookupTableVec3_3 {
        constructor();
        addPair(x: number, y: PxVec3): boolean;
        interpolate(x: number): PxVec3;
        clear(): void;
        isValid(): boolean;
    }
    class PxVehicleFourWheelDriveDifferentialParams extends PxVehicleMultiWheelDriveDifferentialParams {
        constructor();
        setToDefault(): void;
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleFourWheelDriveDifferentialParams;
        frontWheelIds: ReadonlyArray<number>;
        get_frontWheelIds(): ReadonlyArray<number>;
        set_frontWheelIds(value: ReadonlyArray<number>): void;
        rearWheelIds: ReadonlyArray<number>;
        get_rearWheelIds(): ReadonlyArray<number>;
        set_rearWheelIds(value: ReadonlyArray<number>): void;
        frontBias: number;
        get_frontBias(): number;
        set_frontBias(value: number): void;
        frontTarget: number;
        get_frontTarget(): number;
        set_frontTarget(value: number): void;
        rearBias: number;
        get_rearBias(): number;
        set_rearBias(value: number): void;
        rearTarget: number;
        get_rearTarget(): number;
        set_rearTarget(value: number): void;
        centerBias: number;
        get_centerBias(): number;
        set_centerBias(value: number): void;
        centerTarget: number;
        get_centerTarget(): number;
        set_centerTarget(value: number): void;
        rate: number;
        get_rate(): number;
        set_rate(value: number): void;
    }
    class PxVehicleFrame {
        constructor();
        setToDefault(): void;
        getFrame(): PxMat33;
        isValid(): boolean;
        lngAxis: PxVehicleAxesEnum;
        get_lngAxis(): PxVehicleAxesEnum;
        set_lngAxis(value: PxVehicleAxesEnum): void;
        latAxis: PxVehicleAxesEnum;
        get_latAxis(): PxVehicleAxesEnum;
        set_latAxis(value: PxVehicleAxesEnum): void;
        vrtAxis: PxVehicleAxesEnum;
        get_vrtAxis(): PxVehicleAxesEnum;
        set_vrtAxis(value: PxVehicleAxesEnum): void;
    }
    class PxVehicleGearboxParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleGearboxParams;
        isValid(): boolean;
        neutralGear: number;
        get_neutralGear(): number;
        set_neutralGear(value: number): void;
        ratios: ReadonlyArray<number>;
        get_ratios(): ReadonlyArray<number>;
        set_ratios(value: ReadonlyArray<number>): void;
        finalRatio: number;
        get_finalRatio(): number;
        set_finalRatio(value: number): void;
        nbRatios: number;
        get_nbRatios(): number;
        set_nbRatios(value: number): void;
        switchTime: number;
        get_switchTime(): number;
        set_switchTime(value: number): void;
    }
    class PxVehicleGearboxState {
        constructor();
        setToDefault(): void;
        currentGear: number;
        get_currentGear(): number;
        set_currentGear(value: number): void;
        targetGear: number;
        get_targetGear(): number;
        set_targetGear(value: number): void;
        gearSwitchTime: number;
        get_gearSwitchTime(): number;
        set_gearSwitchTime(value: number): void;
    }
    class PxVehicleMultiWheelDriveDifferentialParams {
        constructor();
        setToDefault(): void;
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleMultiWheelDriveDifferentialParams;
        isValid(axleDesc: PxVehicleAxleDescription): boolean;
        torqueRatios: ReadonlyArray<number>;
        get_torqueRatios(): ReadonlyArray<number>;
        set_torqueRatios(value: ReadonlyArray<number>): void;
        aveWheelSpeedRatios: ReadonlyArray<number>;
        get_aveWheelSpeedRatios(): ReadonlyArray<number>;
        set_aveWheelSpeedRatios(value: ReadonlyArray<number>): void;
    }
    class PxVehiclePhysXActor {
        setToDefault(): void;
        rigidBody: PxRigidBody;
        get_rigidBody(): PxRigidBody;
        set_rigidBody(value: PxRigidBody): void;
        wheelShapes: ReadonlyArray<PxShape>;
        get_wheelShapes(): ReadonlyArray<PxShape>;
        set_wheelShapes(value: ReadonlyArray<PxShape>): void;
    }
    class PxVehiclePhysXConstraintState {
        constructor();
        setToDefault(): void;
        tireActiveStatus: ReadonlyArray<boolean>;
        get_tireActiveStatus(): ReadonlyArray<boolean>;
        set_tireActiveStatus(value: ReadonlyArray<boolean>): void;
        tireLinears: ReadonlyArray<PxVec3>;
        get_tireLinears(): ReadonlyArray<PxVec3>;
        set_tireLinears(value: ReadonlyArray<PxVec3>): void;
        tireAngulars: ReadonlyArray<PxVec3>;
        get_tireAngulars(): ReadonlyArray<PxVec3>;
        set_tireAngulars(value: ReadonlyArray<PxVec3>): void;
        tireDamping: ReadonlyArray<number>;
        get_tireDamping(): ReadonlyArray<number>;
        set_tireDamping(value: ReadonlyArray<number>): void;
        suspActiveStatus: boolean;
        get_suspActiveStatus(): boolean;
        set_suspActiveStatus(value: boolean): void;
        suspLinear: PxVec3;
        get_suspLinear(): PxVec3;
        set_suspLinear(value: PxVec3): void;
        suspAngular: PxVec3;
        get_suspAngular(): PxVec3;
        set_suspAngular(value: PxVec3): void;
        suspGeometricError: number;
        get_suspGeometricError(): number;
        set_suspGeometricError(value: number): void;
        restitution: number;
        get_restitution(): number;
        set_restitution(value: number): void;
    }
    class PxVehiclePhysXConstraints {
        setToDefault(): void;
        constraintStates: ReadonlyArray<PxVehiclePhysXConstraintState>;
        get_constraintStates(): ReadonlyArray<PxVehiclePhysXConstraintState>;
        set_constraintStates(value: ReadonlyArray<PxVehiclePhysXConstraintState>): void;
        constraints: ReadonlyArray<PxConstraint>;
        get_constraints(): ReadonlyArray<PxConstraint>;
        set_constraints(value: ReadonlyArray<PxConstraint>): void;
        constraintConnectors: ReadonlyArray<PxVehicleConstraintConnector>;
        get_constraintConnectors(): ReadonlyArray<PxVehicleConstraintConnector>;
        set_constraintConnectors(value: ReadonlyArray<PxVehicleConstraintConnector>): void;
    }
    class PxVehiclePhysXMaterialFriction {
        constructor();
        isValid(): boolean;
        material: PxMaterial;
        get_material(): PxMaterial;
        set_material(value: PxMaterial): void;
        friction: number;
        get_friction(): number;
        set_friction(value: number): void;
    }
    class PxVehiclePhysXMaterialFrictionParams {
        isValid(): boolean;
        materialFrictions: PxVehiclePhysXMaterialFriction;
        get_materialFrictions(): PxVehiclePhysXMaterialFriction;
        set_materialFrictions(value: PxVehiclePhysXMaterialFriction): void;
        nbMaterialFrictions: number;
        get_nbMaterialFrictions(): number;
        set_nbMaterialFrictions(value: number): void;
        defaultFriction: number;
        get_defaultFriction(): number;
        set_defaultFriction(value: number): void;
    }
    class PxVehiclePhysXRoadGeometryQueryParams {
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehiclePhysXRoadGeometryQueryParams;
        isValid(): boolean;
        roadGeometryQueryType: PxVehiclePhysXRoadGeometryQueryTypeEnum;
        get_roadGeometryQueryType(): PxVehiclePhysXRoadGeometryQueryTypeEnum;
        set_roadGeometryQueryType(value: PxVehiclePhysXRoadGeometryQueryTypeEnum): void;
        defaultFilterData: PxQueryFilterData;
        get_defaultFilterData(): PxQueryFilterData;
        set_defaultFilterData(value: PxQueryFilterData): void;
        filterDataEntries: PxQueryFilterData;
        get_filterDataEntries(): PxQueryFilterData;
        set_filterDataEntries(value: PxQueryFilterData): void;
        filterCallback: PxQueryFilterCallback;
        get_filterCallback(): PxQueryFilterCallback;
        set_filterCallback(value: PxQueryFilterCallback): void;
    }
    class PxVehiclePhysXSimulationContext extends PxVehicleSimulationContext {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehiclePhysXSimulationContext;
        physxUnitCylinderSweepMesh: PxConvexMesh;
        get_physxUnitCylinderSweepMesh(): PxConvexMesh;
        set_physxUnitCylinderSweepMesh(value: PxConvexMesh): void;
        physxScene: PxScene;
        get_physxScene(): PxScene;
        set_physxScene(value: PxScene): void;
        physxActorUpdateMode: PxVehiclePhysXActorUpdateModeEnum;
        get_physxActorUpdateMode(): PxVehiclePhysXActorUpdateModeEnum;
        set_physxActorUpdateMode(value: PxVehiclePhysXActorUpdateModeEnum): void;
        physxActorWakeCounterResetValue: number;
        get_physxActorWakeCounterResetValue(): number;
        set_physxActorWakeCounterResetValue(value: number): void;
        physxActorWakeCounterThreshold: number;
        get_physxActorWakeCounterThreshold(): number;
        set_physxActorWakeCounterThreshold(value: number): void;
    }
    class PxVehiclePhysXSteerState {
        setToDefault(): void;
        previousSteerCommand: number;
        get_previousSteerCommand(): number;
        set_previousSteerCommand(value: number): void;
    }
    class PxVehiclePhysXSuspensionLimitConstraintParams {
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehiclePhysXSuspensionLimitConstraintParams;
        isValid(): boolean;
        restitution: number;
        get_restitution(): number;
        set_restitution(value: number): void;
        directionForSuspensionLimitConstraint: PxVehiclePhysXSuspensionLimitConstraintParamsDirectionSpecifierEnum;
        get_directionForSuspensionLimitConstraint(): PxVehiclePhysXSuspensionLimitConstraintParamsDirectionSpecifierEnum;
        set_directionForSuspensionLimitConstraint(value: PxVehiclePhysXSuspensionLimitConstraintParamsDirectionSpecifierEnum): void;
    }
    class PxVehiclePvdContext {
    }
    class PxVehicleRigidBodyParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleRigidBodyParams;
        isValid(): boolean;
        mass: number;
        get_mass(): number;
        set_mass(value: number): void;
        moi: PxVec3;
        get_moi(): PxVec3;
        set_moi(value: PxVec3): void;
    }
    class PxVehicleRigidBodyState {
        constructor();
        setToDefault(): void;
        getVerticalSpeed(frame: PxVehicleFrame): number;
        getLateralSpeed(frame: PxVehicleFrame): number;
        getLongitudinalSpeed(frame: PxVehicleFrame): number;
        pose: PxTransform;
        get_pose(): PxTransform;
        set_pose(value: PxTransform): void;
        linearVelocity: PxVec3;
        get_linearVelocity(): PxVec3;
        set_linearVelocity(value: PxVec3): void;
        angularVelocity: PxVec3;
        get_angularVelocity(): PxVec3;
        set_angularVelocity(value: PxVec3): void;
        previousLinearVelocity: PxVec3;
        get_previousLinearVelocity(): PxVec3;
        set_previousLinearVelocity(value: PxVec3): void;
        previousAngularVelocity: PxVec3;
        get_previousAngularVelocity(): PxVec3;
        set_previousAngularVelocity(value: PxVec3): void;
        externalForce: PxVec3;
        get_externalForce(): PxVec3;
        set_externalForce(value: PxVec3): void;
        externalTorque: PxVec3;
        get_externalTorque(): PxVec3;
        set_externalTorque(value: PxVec3): void;
    }
    class PxVehicleRoadGeometryState {
        constructor();
        setToDefault(): void;
        plane: PxPlane;
        get_plane(): PxPlane;
        set_plane(value: PxPlane): void;
        friction: number;
        get_friction(): number;
        set_friction(value: number): void;
        velocity: PxVec3;
        get_velocity(): PxVec3;
        set_velocity(value: PxVec3): void;
        hitState: boolean;
        get_hitState(): boolean;
        set_hitState(value: boolean): void;
    }
    class PxVehicleScale {
        constructor();
        setToDefault(): void;
        isValid(): boolean;
        scale: number;
        get_scale(): number;
        set_scale(value: number): void;
    }
    class PxVehicleSimulationContext {
        constructor();
        getType(): PxVehicleSimulationContextTypeEnum;
        setToDefault(): void;
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleSimulationContext;
        gravity: PxVec3;
        get_gravity(): PxVec3;
        set_gravity(value: PxVec3): void;
        frame: PxVehicleFrame;
        get_frame(): PxVehicleFrame;
        set_frame(value: PxVehicleFrame): void;
        scale: PxVehicleScale;
        get_scale(): PxVehicleScale;
        set_scale(value: PxVehicleScale): void;
        tireSlipParams: PxVehicleTireSlipParams;
        get_tireSlipParams(): PxVehicleTireSlipParams;
        set_tireSlipParams(value: PxVehicleTireSlipParams): void;
        tireStickyParams: PxVehicleTireStickyParams;
        get_tireStickyParams(): PxVehicleTireStickyParams;
        set_tireStickyParams(value: PxVehicleTireStickyParams): void;
        thresholdForwardSpeedForWheelAngleIntegration: number;
        get_thresholdForwardSpeedForWheelAngleIntegration(): number;
        set_thresholdForwardSpeedForWheelAngleIntegration(value: number): void;
        pvdContext: PxVehiclePvdContext;
        get_pvdContext(): PxVehiclePvdContext;
        set_pvdContext(value: PxVehiclePvdContext): void;
    }
    class PxVehicleSteerCommandResponseParams extends PxVehicleCommandResponseParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleSteerCommandResponseParams;
        isValid(axleDesc: PxVehicleAxleDescription): boolean;
    }
    class PxVehicleSuspensionComplianceParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleSuspensionComplianceParams;
        isValid(): boolean;
        wheelToeAngle: PxVehicleFixedSizeLookupTableFloat_3;
        get_wheelToeAngle(): PxVehicleFixedSizeLookupTableFloat_3;
        set_wheelToeAngle(value: PxVehicleFixedSizeLookupTableFloat_3): void;
        wheelCamberAngle: PxVehicleFixedSizeLookupTableFloat_3;
        get_wheelCamberAngle(): PxVehicleFixedSizeLookupTableFloat_3;
        set_wheelCamberAngle(value: PxVehicleFixedSizeLookupTableFloat_3): void;
        suspForceAppPoint: PxVehicleFixedSizeLookupTableVec3_3;
        get_suspForceAppPoint(): PxVehicleFixedSizeLookupTableVec3_3;
        set_suspForceAppPoint(value: PxVehicleFixedSizeLookupTableVec3_3): void;
        tireForceAppPoint: PxVehicleFixedSizeLookupTableVec3_3;
        get_tireForceAppPoint(): PxVehicleFixedSizeLookupTableVec3_3;
        set_tireForceAppPoint(value: PxVehicleFixedSizeLookupTableVec3_3): void;
    }
    class PxVehicleSuspensionComplianceState {
        constructor();
        setToDefault(): void;
        toe: number;
        get_toe(): number;
        set_toe(value: number): void;
        camber: number;
        get_camber(): number;
        set_camber(value: number): void;
        tireForceAppPoint: PxVec3;
        get_tireForceAppPoint(): PxVec3;
        set_tireForceAppPoint(value: PxVec3): void;
        suspForceAppPoint: PxVec3;
        get_suspForceAppPoint(): PxVec3;
        set_suspForceAppPoint(value: PxVec3): void;
    }
    class PxVehicleSuspensionForce {
        constructor();
        setToDefault(): void;
        force: PxVec3;
        get_force(): PxVec3;
        set_force(value: PxVec3): void;
        torque: PxVec3;
        get_torque(): PxVec3;
        set_torque(value: PxVec3): void;
        normalForce: number;
        get_normalForce(): number;
        set_normalForce(value: number): void;
    }
    class PxVehicleSuspensionForceParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleSuspensionForceParams;
        isValid(): boolean;
        stiffness: number;
        get_stiffness(): number;
        set_stiffness(value: number): void;
        damping: number;
        get_damping(): number;
        set_damping(value: number): void;
        sprungMass: number;
        get_sprungMass(): number;
        set_sprungMass(value: number): void;
    }
    class PxVehicleSuspensionParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleSuspensionParams;
        isValid(): boolean;
        suspensionAttachment: PxTransform;
        get_suspensionAttachment(): PxTransform;
        set_suspensionAttachment(value: PxTransform): void;
        suspensionTravelDir: PxVec3;
        get_suspensionTravelDir(): PxVec3;
        set_suspensionTravelDir(value: PxVec3): void;
        suspensionTravelDist: number;
        get_suspensionTravelDist(): number;
        set_suspensionTravelDist(value: number): void;
        wheelAttachment: PxTransform;
        get_wheelAttachment(): PxTransform;
        set_wheelAttachment(value: PxTransform): void;
    }
    class PxVehicleSuspensionState {
        constructor();
        setToDefault(_jounce: number, _separation: number): void;
        jounce: number;
        get_jounce(): number;
        set_jounce(value: number): void;
        jounceSpeed: number;
        get_jounceSpeed(): number;
        set_jounceSpeed(value: number): void;
        separation: number;
        get_separation(): number;
        set_separation(value: number): void;
    }
    class PxVehicleSuspensionStateCalculationParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleSuspensionStateCalculationParams;
        isValid(): boolean;
        suspensionJounceCalculationType: PxVehicleSuspensionJounceCalculationTypeEnum;
        get_suspensionJounceCalculationType(): PxVehicleSuspensionJounceCalculationTypeEnum;
        set_suspensionJounceCalculationType(value: PxVehicleSuspensionJounceCalculationTypeEnum): void;
        limitSuspensionExpansionVelocity: boolean;
        get_limitSuspensionExpansionVelocity(): boolean;
        set_limitSuspensionExpansionVelocity(value: boolean): void;
    }
    class PxVehicleTankDriveDifferentialParams extends PxVehicleMultiWheelDriveDifferentialParams {
        constructor();
        setToDefault(): void;
        getNbWheelsInTrack(i: number): number;
        getWheelsInTrack(i: number): PxU32ConstPtr;
        getWheelInTrack(j: number, i: number): number;
        getThrustControllerIndex(i: number): number;
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleTankDriveDifferentialParams;
        nbTracks: number;
        get_nbTracks(): number;
        set_nbTracks(value: number): void;
        thrustIdPerTrack: ReadonlyArray<number>;
        get_thrustIdPerTrack(): ReadonlyArray<number>;
        set_thrustIdPerTrack(value: ReadonlyArray<number>): void;
        nbWheelsPerTrack: ReadonlyArray<number>;
        get_nbWheelsPerTrack(): ReadonlyArray<number>;
        set_nbWheelsPerTrack(value: ReadonlyArray<number>): void;
        trackToWheelIds: ReadonlyArray<number>;
        get_trackToWheelIds(): ReadonlyArray<number>;
        set_trackToWheelIds(value: ReadonlyArray<number>): void;
        wheelIdsInTrackOrder: ReadonlyArray<number>;
        get_wheelIdsInTrackOrder(): ReadonlyArray<number>;
        set_wheelIdsInTrackOrder(value: ReadonlyArray<number>): void;
    }
    class PxVehicleTankDriveTransmissionCommandState extends PxVehicleEngineDriveTransmissionCommandState {
        constructor();
        setToDefault(): void;
        thrusts: ReadonlyArray<number>;
        get_thrusts(): ReadonlyArray<number>;
        set_thrusts(value: ReadonlyArray<number>): void;
    }
    class PxVehicleTireAxisStickyParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleTireAxisStickyParams;
        isValid(): boolean;
        thresholdSpeed: number;
        get_thresholdSpeed(): number;
        set_thresholdSpeed(value: number): void;
        thresholdTime: number;
        get_thresholdTime(): number;
        set_thresholdTime(value: number): void;
        damping: number;
        get_damping(): number;
        set_damping(value: number): void;
    }
    class PxVehicleTireCamberAngleState {
        constructor();
        setToDefault(): void;
        camberAngle: number;
        get_camberAngle(): number;
        set_camberAngle(value: number): void;
    }
    class PxVehicleTireDirectionState {
        constructor();
        setToDefault(): void;
        directions: ReadonlyArray<PxVec3>;
        get_directions(): ReadonlyArray<PxVec3>;
        set_directions(value: ReadonlyArray<PxVec3>): void;
    }
    class PxVehicleTireForce {
        constructor();
        setToDefault(): void;
        forces: ReadonlyArray<PxVec3>;
        get_forces(): ReadonlyArray<PxVec3>;
        set_forces(value: ReadonlyArray<PxVec3>): void;
        torques: ReadonlyArray<PxVec3>;
        get_torques(): ReadonlyArray<PxVec3>;
        set_torques(value: ReadonlyArray<PxVec3>): void;
        aligningMoment: number;
        get_aligningMoment(): number;
        set_aligningMoment(value: number): void;
        wheelTorque: number;
        get_wheelTorque(): number;
        set_wheelTorque(value: number): void;
    }
    class PxVehicleTireForceParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleTireForceParams;
        isValid(): boolean;
        latStiffX: number;
        get_latStiffX(): number;
        set_latStiffX(value: number): void;
        latStiffY: number;
        get_latStiffY(): number;
        set_latStiffY(value: number): void;
        longStiff: number;
        get_longStiff(): number;
        set_longStiff(value: number): void;
        camberStiff: number;
        get_camberStiff(): number;
        set_camberStiff(value: number): void;
        restLoad: number;
        get_restLoad(): number;
        set_restLoad(value: number): void;
    }
    class PxVehicleTireForceParamsExt {
        static setFrictionVsSlip(tireForceParams: PxVehicleTireForceParams, i: number, j: number, value: number): void;
        static setLoadFilter(tireForceParams: PxVehicleTireForceParams, i: number, j: number, value: number): void;
    }
    class PxVehicleTireGripState {
        setToDefault(): void;
        load: number;
        get_load(): number;
        set_load(value: number): void;
        friction: number;
        get_friction(): number;
        set_friction(value: number): void;
    }
    class PxVehicleTireSlipParams {
        constructor();
        setToDefault(): void;
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleTireSlipParams;
        isValid(): boolean;
        minLatSlipDenominator: number;
        get_minLatSlipDenominator(): number;
        set_minLatSlipDenominator(value: number): void;
        minPassiveLongSlipDenominator: number;
        get_minPassiveLongSlipDenominator(): number;
        set_minPassiveLongSlipDenominator(value: number): void;
        minActiveLongSlipDenominator: number;
        get_minActiveLongSlipDenominator(): number;
        set_minActiveLongSlipDenominator(value: number): void;
    }
    class PxVehicleTireSlipState {
        constructor();
        setToDefault(): void;
        slips: ReadonlyArray<number>;
        get_slips(): ReadonlyArray<number>;
        set_slips(value: ReadonlyArray<number>): void;
    }
    class PxVehicleTireSpeedState {
        constructor();
        setToDefault(): void;
        speedStates: ReadonlyArray<number>;
        get_speedStates(): ReadonlyArray<number>;
        set_speedStates(value: ReadonlyArray<number>): void;
    }
    class PxVehicleTireStickyParams {
        constructor();
        setToDefault(): void;
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleTireStickyParams;
        isValid(): boolean;
        stickyParams: ReadonlyArray<PxVehicleTireAxisStickyParams>;
        get_stickyParams(): ReadonlyArray<PxVehicleTireAxisStickyParams>;
        set_stickyParams(value: ReadonlyArray<PxVehicleTireAxisStickyParams>): void;
    }
    class PxVehicleTireStickyState {
        constructor();
        setToDefault(): void;
        lowSpeedTime: ReadonlyArray<number>;
        get_lowSpeedTime(): ReadonlyArray<number>;
        set_lowSpeedTime(value: ReadonlyArray<number>): void;
        activeStatus: ReadonlyArray<boolean>;
        get_activeStatus(): ReadonlyArray<boolean>;
        set_activeStatus(value: ReadonlyArray<boolean>): void;
    }
    class PxVehicleTopLevelFunctions {
        static InitVehicleExtension(foundation: PxFoundation): boolean;
        static CloseVehicleExtension(): void;
        static VehicleComputeSprungMasses(nbSprungMasses: number, sprungMassCoordinates: PxArray_PxVec3, totalMass: number, gravityDirection: PxVehicleAxesEnum, sprungMasses: PxArray_PxReal): boolean;
        static VehicleUnitCylinderSweepMeshCreate(vehicleFrame: PxVehicleFrame, physics: PxPhysics, params: PxCookingParams): PxConvexMesh;
        static VehicleUnitCylinderSweepMeshDestroy(mesh: PxConvexMesh): void;
        static readonly MAX_NB_ENGINE_TORQUE_CURVE_ENTRIES: number;
        static get_MAX_NB_ENGINE_TORQUE_CURVE_ENTRIES(): number;
    }
    class PxVehicleTorqueCurveLookupTable {
        constructor();
        addPair(x: number, y: number): boolean;
        interpolate(x: number): number;
        clear(): void;
        isValid(): boolean;
    }
    class PxVehicleWheelActuationState {
        constructor();
        setToDefault(): void;
        isBrakeApplied: boolean;
        get_isBrakeApplied(): boolean;
        set_isBrakeApplied(value: boolean): void;
        isDriveApplied: boolean;
        get_isDriveApplied(): boolean;
        set_isDriveApplied(value: boolean): void;
    }
    class PxVehicleWheelConstraintGroupState {
        constructor();
        setToDefault(): void;
        getNbConstraintGroups(): number;
        getNbWheelsInConstraintGroup(i: number): number;
        getWheelInConstraintGroup(j: number, i: number): number;
        getMultiplierInConstraintGroup(j: number, i: number): number;
        nbGroups: number;
        get_nbGroups(): number;
        set_nbGroups(value: number): void;
        nbWheelsPerGroup: ReadonlyArray<number>;
        get_nbWheelsPerGroup(): ReadonlyArray<number>;
        set_nbWheelsPerGroup(value: ReadonlyArray<number>): void;
        groupToWheelIds: ReadonlyArray<number>;
        get_groupToWheelIds(): ReadonlyArray<number>;
        set_groupToWheelIds(value: ReadonlyArray<number>): void;
        wheelIdsInGroupOrder: ReadonlyArray<number>;
        get_wheelIdsInGroupOrder(): ReadonlyArray<number>;
        set_wheelIdsInGroupOrder(value: ReadonlyArray<number>): void;
        wheelMultipliersInGroupOrder: ReadonlyArray<number>;
        get_wheelMultipliersInGroupOrder(): ReadonlyArray<number>;
        set_wheelMultipliersInGroupOrder(value: ReadonlyArray<number>): void;
        nbWheelsInGroups: number;
        get_nbWheelsInGroups(): number;
        set_nbWheelsInGroups(value: number): void;
    }
    class PxVehicleWheelLocalPose {
        constructor();
        setToDefault(): void;
        localPose: PxTransform;
        get_localPose(): PxTransform;
        set_localPose(value: PxTransform): void;
    }
    class PxVehicleWheelParams {
        constructor();
        transformAndScale(srcFrame: PxVehicleFrame, trgFrame: PxVehicleFrame, srcScale: PxVehicleScale, trgScale: PxVehicleScale): PxVehicleWheelParams;
        isValid(): boolean;
        radius: number;
        get_radius(): number;
        set_radius(value: number): void;
        halfWidth: number;
        get_halfWidth(): number;
        set_halfWidth(value: number): void;
        mass: number;
        get_mass(): number;
        set_mass(value: number): void;
        moi: number;
        get_moi(): number;
        set_moi(value: number): void;
        dampingRate: number;
        get_dampingRate(): number;
        set_dampingRate(value: number): void;
    }
    class PxVehicleWheelRigidBody1dState {
        constructor();
        setToDefault(): void;
        rotationSpeed: number;
        get_rotationSpeed(): number;
        set_rotationSpeed(value: number): void;
        correctedRotationSpeed: number;
        get_correctedRotationSpeed(): number;
        set_correctedRotationSpeed(value: number): void;
        rotationAngle: number;
        get_rotationAngle(): number;
        set_rotationAngle(value: number): void;
    }
    class SimplPvdTransportImpl {
        constructor();
        connect(): boolean;
        isConnected(): boolean;
        disconnect(): void;
        send(inBytes: any, inLength: number): void;
        flush(): void;
    }
    class SimpleControllerBehaviorCallback extends PxControllerBehaviorCallback {
        getShapeBehaviorFlags(shape: PxShape, actor: PxActor): number;
        getControllerBehaviorFlags(controller: PxController): number;
        getObstacleBehaviorFlags(obstacle: PxObstacle): number;
    }
    class SimplePvdTransport extends PxPvdTransport {
        send(inBytes: any, inLength: number): void;
    }
    class SimpleQueryFilterCallback extends PxQueryFilterCallback {
        simplePreFilter(filterData: PxFilterData, shape: PxShape, actor: PxRigidActor, queryFlags: PxHitFlags): number;
        simplePostFilter(filterData: PxFilterData, hit: PxQueryHit, shape: PxShape, actor: PxRigidActor): number;
    }
    class SimpleSimulationEventCallback extends PxSimulationEventCallback {
        onConstraintBreak(constraints: PxConstraintInfo, count: number): void;
        onWake(actors: PxActorPtr, count: number): void;
        onSleep(actors: PxActorPtr, count: number): void;
        onContact(pairHeader: PxContactPairHeader, pairs: PxContactPair, nbPairs: number): void;
        onTrigger(pairs: PxTriggerPair, count: number): void;
    }
    class SphereSupport extends Support {
        constructor(radius: number);
        radius: number;
        get_radius(): number;
        set_radius(value: number): void;
    }
    class Support {
        getMargin(): number;
        supportLocal(dir: PxVec3): PxVec3;
    }
    class SupportFunctions {
        static PxActor_getShape(actor: PxRigidActor, index: number): PxShape;
        static PxScene_getActiveActors(scene: PxScene): PxArray_PxActorPtr;
        static PxArticulationReducedCoordinate_getMinSolverPositionIterations(articulation: PxArticulationReducedCoordinate): number;
        static PxArticulationReducedCoordinate_getMinSolverVelocityIterations(articulation: PxArticulationReducedCoordinate): number;
    }
    class Vector_PxActorPtr {
        constructor();
        constructor(size: number);
        at(index: number): PxActor;
        data(): PxActorPtr;
        size(): number;
        push_back(value: PxActor): void;
        clear(): void;
    }
    class Vector_PxContactPairPoint {
        constructor();
        constructor(size: number);
        at(index: number): PxContactPairPoint;
        data(): PxContactPairPoint;
        size(): number;
        push_back(value: PxContactPairPoint): void;
        clear(): void;
    }
    class Vector_PxHeightFieldSample {
        constructor();
        constructor(size: number);
        at(index: number): PxHeightFieldSample;
        data(): PxHeightFieldSample;
        size(): number;
        push_back(value: PxHeightFieldSample): void;
        clear(): void;
    }
    class Vector_PxMaterialConst {
        constructor();
        constructor(size: number);
        at(index: number): PxMaterial;
        data(): PxMaterialConstPtr;
        size(): number;
        push_back(value: PxMaterial): void;
        clear(): void;
    }
    class Vector_PxRaycastHit {
        constructor();
        constructor(size: number);
        at(index: number): PxRaycastHit;
        data(): PxRaycastHit;
        size(): number;
        push_back(value: PxRaycastHit): void;
        clear(): void;
    }
    class Vector_PxReal {
        constructor();
        constructor(size: number);
        at(index: number): number;
        data(): VoidPtr;
        size(): number;
        push_back(value: number): void;
        clear(): void;
    }
    class Vector_PxSweepHit {
        constructor();
        constructor(size: number);
        at(index: number): PxSweepHit;
        data(): PxSweepHit;
        size(): number;
        push_back(value: PxSweepHit): void;
        clear(): void;
    }
    class Vector_PxU16 {
        constructor();
        constructor(size: number);
        at(index: number): number;
        data(): VoidPtr;
        size(): number;
        push_back(value: number): void;
        clear(): void;
    }
    class Vector_PxU32 {
        constructor();
        constructor(size: number);
        at(index: number): number;
        data(): VoidPtr;
        size(): number;
        push_back(value: number): void;
        clear(): void;
    }
    class Vector_PxU8 {
        constructor();
        constructor(size: number);
        at(index: number): number;
        data(): VoidPtr;
        size(): number;
        push_back(value: number): void;
        clear(): void;
    }
    class Vector_PxVec3 {
        constructor();
        constructor(size: number);
        at(index: number): PxVec3;
        data(): PxVec3;
        size(): number;
        push_back(value: PxVec3): void;
        clear(): void;
    }
    class Vector_PxVec4 {
        constructor();
        constructor(size: number);
        at(index: number): PxVec4;
        data(): PxVec4;
        size(): number;
        push_back(value: PxVec4): void;
        clear(): void;
    }
    type EngineDriveVehicleEnum = number;
    const EngineDriveVehicleEnum: {
        readonly eDIFFTYPE_FOURWHEELDRIVE: number;
        readonly eDIFFTYPE_MULTIWHEELDRIVE: number;
        readonly eDIFFTYPE_TANKDRIVE: number;
    };
    type PxActorFlagEnum = number;
    const PxActorFlagEnum: {
        readonly eVISUALIZATION: number;
        readonly eDISABLE_GRAVITY: number;
        readonly eSEND_SLEEP_NOTIFIES: number;
        readonly eDISABLE_SIMULATION: number;
    };
    type PxActorTypeEnum = number;
    const PxActorTypeEnum: {
        readonly eRIGID_STATIC: number;
        readonly eRIGID_DYNAMIC: number;
        readonly eARTICULATION_LINK: number;
        readonly eDEFORMABLE_SURFACE: number;
        readonly eDEFORMABLE_VOLUME: number;
        readonly ePBD_PARTICLESYSTEM: number;
    };
    type PxActorTypeFlagEnum = number;
    const PxActorTypeFlagEnum: {
        readonly eRIGID_STATIC: number;
        readonly eRIGID_DYNAMIC: number;
    };
    type PxArticulationAxisEnum = number;
    const PxArticulationAxisEnum: {
        readonly eTWIST: number;
        readonly eSWING1: number;
        readonly eSWING2: number;
        readonly eX: number;
        readonly eY: number;
        readonly eZ: number;
    };
    type PxArticulationCacheFlagEnum = number;
    const PxArticulationCacheFlagEnum: {
        readonly eVELOCITY: number;
        readonly eACCELERATION: number;
        readonly ePOSITION: number;
        readonly eFORCE: number;
        readonly eLINK_VELOCITY: number;
        readonly eLINK_ACCELERATION: number;
        readonly eROOT_TRANSFORM: number;
        readonly eROOT_VELOCITIES: number;
        readonly eLINK_INCOMING_JOINT_FORCE: number;
        readonly eJOINT_TARGET_POSITIONS: number;
        readonly eJOINT_TARGET_VELOCITIES: number;
        readonly eALL: number;
    };
    type PxArticulationDriveTypeEnum = number;
    const PxArticulationDriveTypeEnum: {
        readonly eFORCE: number;
        readonly eACCELERATION: number;
        readonly eNONE: number;
    };
    type PxArticulationFlagEnum = number;
    const PxArticulationFlagEnum: {
        readonly eFIX_BASE: number;
        readonly eDRIVE_LIMITS_ARE_FORCES: number;
        readonly eDISABLE_SELF_COLLISION: number;
    };
    type PxArticulationJointTypeEnum = number;
    const PxArticulationJointTypeEnum: {
        readonly eFIX: number;
        readonly ePRISMATIC: number;
        readonly eREVOLUTE: number;
        readonly eSPHERICAL: number;
        readonly eUNDEFINED: number;
    };
    type PxArticulationKinematicFlagEnum = number;
    const PxArticulationKinematicFlagEnum: {
        readonly ePOSITION: number;
        readonly eVELOCITY: number;
    };
    type PxArticulationMotionEnum = number;
    const PxArticulationMotionEnum: {
        readonly eLOCKED: number;
        readonly eLIMITED: number;
        readonly eFREE: number;
    };
    type PxBVHBuildStrategyEnum = number;
    const PxBVHBuildStrategyEnum: {
        readonly eFAST: number;
        readonly eDEFAULT: number;
        readonly eSAH: number;
    };
    type PxBaseFlagEnum = number;
    const PxBaseFlagEnum: {
        readonly eOWNS_MEMORY: number;
        readonly eIS_RELEASABLE: number;
    };
    type PxBroadPhaseTypeEnum = number;
    const PxBroadPhaseTypeEnum: {
        readonly eSAP: number;
        readonly eMBP: number;
        readonly eABP: number;
        readonly ePABP: number;
        readonly eGPU: number;
    };
    type PxCapsuleClimbingModeEnum = number;
    const PxCapsuleClimbingModeEnum: {
        readonly eEASY: number;
        readonly eCONSTRAINED: number;
    };
    type PxCombineModeEnum = number;
    const PxCombineModeEnum: {
        readonly eAVERAGE: number;
        readonly eMIN: number;
        readonly eMULTIPLY: number;
        readonly eMAX: number;
    };
    type PxConstraintFlagEnum = number;
    const PxConstraintFlagEnum: {
        readonly eBROKEN: number;
        readonly eCOLLISION_ENABLED: number;
        readonly eVISUALIZATION: number;
        readonly eDRIVE_LIMITS_ARE_FORCES: number;
        readonly eIMPROVED_SLERP: number;
        readonly eDISABLE_PREPROCESSING: number;
        readonly eENABLE_EXTENDED_LIMITS: number;
        readonly eGPU_COMPATIBLE: number;
        readonly eALWAYS_UPDATE: number;
        readonly eDISABLE_CONSTRAINT: number;
    };
    type PxContactPairFlagEnum = number;
    const PxContactPairFlagEnum: {
        readonly eREMOVED_SHAPE_0: number;
        readonly eREMOVED_SHAPE_1: number;
        readonly eACTOR_PAIR_HAS_FIRST_TOUCH: number;
        readonly eACTOR_PAIR_LOST_TOUCH: number;
        readonly eINTERNAL_HAS_IMPULSES: number;
        readonly eINTERNAL_CONTACTS_ARE_FLIPPED: number;
    };
    type PxContactPairHeaderFlagEnum = number;
    const PxContactPairHeaderFlagEnum: {
        readonly eREMOVED_ACTOR_0: number;
        readonly eREMOVED_ACTOR_1: number;
    };
    type PxControllerBehaviorFlagEnum = number;
    const PxControllerBehaviorFlagEnum: {
        readonly eCCT_CAN_RIDE_ON_OBJECT: number;
        readonly eCCT_SLIDE: number;
        readonly eCCT_USER_DEFINED_RIDE: number;
    };
    type PxControllerCollisionFlagEnum = number;
    const PxControllerCollisionFlagEnum: {
        readonly eCOLLISION_SIDES: number;
        readonly eCOLLISION_UP: number;
        readonly eCOLLISION_DOWN: number;
    };
    type PxControllerNonWalkableModeEnum = number;
    const PxControllerNonWalkableModeEnum: {
        readonly ePREVENT_CLIMBING: number;
        readonly ePREVENT_CLIMBING_AND_FORCE_SLIDING: number;
    };
    type PxControllerShapeTypeEnum = number;
    const PxControllerShapeTypeEnum: {
        readonly eBOX: number;
        readonly eCAPSULE: number;
    };
    type PxConvexCoreTypeEnum = number;
    const PxConvexCoreTypeEnum: {
        readonly ePOINT: number;
        readonly eSEGMENT: number;
        readonly eBOX: number;
        readonly eELLIPSOID: number;
        readonly eCYLINDER: number;
        readonly eCONE: number;
    };
    type PxConvexFlagEnum = number;
    const PxConvexFlagEnum: {
        readonly e16_BIT_INDICES: number;
        readonly eCOMPUTE_CONVEX: number;
        readonly eCHECK_ZERO_AREA_TRIANGLES: number;
        readonly eQUANTIZE_INPUT: number;
        readonly eDISABLE_MESH_VALIDATION: number;
        readonly ePLANE_SHIFTING: number;
        readonly eFAST_INERTIA_COMPUTATION: number;
        readonly eSHIFT_VERTICES: number;
    };
    type PxConvexMeshCookingTypeEnum = number;
    const PxConvexMeshCookingTypeEnum: {
        readonly eQUICKHULL: number;
    };
    type PxConvexMeshGeometryFlagEnum = number;
    const PxConvexMeshGeometryFlagEnum: {
        readonly eTIGHT_BOUNDS: number;
    };
    type PxD6AngularDriveConfigEnum = number;
    const PxD6AngularDriveConfigEnum: {
        readonly eSWING_TWIST: number;
        readonly eSLERP: number;
    };
    type PxD6AxisEnum = number;
    const PxD6AxisEnum: {
        readonly eX: number;
        readonly eY: number;
        readonly eZ: number;
        readonly eTWIST: number;
        readonly eSWING1: number;
        readonly eSWING2: number;
    };
    type PxD6DriveEnum = number;
    const PxD6DriveEnum: {
        readonly eX: number;
        readonly eY: number;
        readonly eZ: number;
        readonly eTWIST: number;
        readonly eSLERP: number;
        readonly eSWING1: number;
        readonly eSWING2: number;
    };
    type PxD6JointDriveFlagEnum = number;
    const PxD6JointDriveFlagEnum: {
        readonly eACCELERATION: number;
    };
    type PxD6MotionEnum = number;
    const PxD6MotionEnum: {
        readonly eLOCKED: number;
        readonly eLIMITED: number;
        readonly eFREE: number;
    };
    type PxDebugColorEnum = number;
    const PxDebugColorEnum: {
        readonly eARGB_BLACK: number;
        readonly eARGB_RED: number;
        readonly eARGB_GREEN: number;
        readonly eARGB_BLUE: number;
        readonly eARGB_YELLOW: number;
        readonly eARGB_MAGENTA: number;
        readonly eARGB_CYAN: number;
        readonly eARGB_WHITE: number;
        readonly eARGB_GREY: number;
        readonly eARGB_DARKRED: number;
        readonly eARGB_DARKGREEN: number;
        readonly eARGB_DARKBLUE: number;
    };
    type PxDistanceJointFlagEnum = number;
    const PxDistanceJointFlagEnum: {
        readonly eMAX_DISTANCE_ENABLED: number;
        readonly eMIN_DISTANCE_ENABLED: number;
        readonly eSPRING_ENABLED: number;
    };
    type PxDynamicTreeSecondaryPrunerEnum = number;
    const PxDynamicTreeSecondaryPrunerEnum: {
        readonly eNONE: number;
        readonly eBUCKET: number;
        readonly eINCREMENTAL: number;
        readonly eBVH: number;
    };
    type PxErrorCodeEnum = number;
    const PxErrorCodeEnum: {
        readonly eNO_ERROR: number;
        readonly eDEBUG_INFO: number;
        readonly eDEBUG_WARNING: number;
        readonly eINVALID_PARAMETER: number;
        readonly eINVALID_OPERATION: number;
        readonly eOUT_OF_MEMORY: number;
        readonly eINTERNAL_ERROR: number;
        readonly eABORT: number;
        readonly ePERF_WARNING: number;
        readonly eMASK_ALL: number;
    };
    type PxFilterFlagEnum = number;
    const PxFilterFlagEnum: {
        readonly eKILL: number;
        readonly eSUPPRESS: number;
        readonly eCALLBACK: number;
        readonly eNOTIFY: number;
        readonly eDEFAULT: number;
    };
    type PxFilterObjectFlagEnum = number;
    const PxFilterObjectFlagEnum: {
        readonly eKINEMATIC: number;
        readonly eTRIGGER: number;
    };
    type PxForceModeEnum = number;
    const PxForceModeEnum: {
        readonly eFORCE: number;
        readonly eIMPULSE: number;
        readonly eVELOCITY_CHANGE: number;
        readonly eACCELERATION: number;
    };
    type PxFrictionTypeEnum = number;
    const PxFrictionTypeEnum: {
        readonly ePATCH: number;
        readonly eFRICTION_COUNT: number;
    };
    type PxGeometryTypeEnum = number;
    const PxGeometryTypeEnum: {
        readonly eSPHERE: number;
        readonly ePLANE: number;
        readonly eCAPSULE: number;
        readonly eBOX: number;
        readonly eCONVEXCORE: number;
        readonly eCONVEXMESH: number;
        readonly ePARTICLESYSTEM: number;
        readonly eTETRAHEDRONMESH: number;
        readonly eTRIANGLEMESH: number;
        readonly eHEIGHTFIELD: number;
        readonly eCUSTOM: number;
    };
    type PxHeightFieldFlagEnum = number;
    const PxHeightFieldFlagEnum: {
        readonly eNO_BOUNDARY_EDGES: number;
    };
    type PxHeightFieldFormatEnum = number;
    const PxHeightFieldFormatEnum: {
        readonly eS16_TM: number;
    };
    type PxHitFlagEnum = number;
    const PxHitFlagEnum: {
        readonly ePOSITION: number;
        readonly eNORMAL: number;
        readonly eUV: number;
        readonly eASSUME_NO_INITIAL_OVERLAP: number;
        readonly eANY_HIT: number;
        readonly eMESH_MULTIPLE: number;
        readonly eMESH_BOTH_SIDES: number;
        readonly ePRECISE_SWEEP: number;
        readonly eMTD: number;
        readonly eFACE_INDEX: number;
        readonly eDEFAULT: number;
        readonly eMODIFIABLE_FLAGS: number;
    };
    type PxIDENTITYEnum = number;
    const PxIDENTITYEnum: {
        readonly PxIdentity: number;
    };
    type PxJointActorIndexEnum = number;
    const PxJointActorIndexEnum: {
        readonly eACTOR0: number;
        readonly eACTOR1: number;
    };
    type PxMaterialFlagEnum = number;
    const PxMaterialFlagEnum: {
        readonly eDISABLE_FRICTION: number;
        readonly eDISABLE_STRONG_FRICTION: number;
        readonly eCOMPLIANT_ACCELERATION_SPRING: number;
    };
    type PxMeshCookingHintEnum = number;
    const PxMeshCookingHintEnum: {
        readonly eSIM_PERFORMANCE: number;
        readonly eCOOKING_PERFORMANCE: number;
    };
    type PxMeshFlagEnum = number;
    const PxMeshFlagEnum: {
        readonly eFLIPNORMALS: number;
        readonly e16_BIT_INDICES: number;
    };
    type PxMeshGeometryFlagEnum = number;
    const PxMeshGeometryFlagEnum: {
        readonly eDOUBLE_SIDED: number;
    };
    type PxMeshMidPhaseEnum = number;
    const PxMeshMidPhaseEnum: {
        readonly eBVH33: number;
        readonly eBVH34: number;
    };
    type PxMeshPreprocessingFlagEnum = number;
    const PxMeshPreprocessingFlagEnum: {
        readonly eWELD_VERTICES: number;
        readonly eDISABLE_CLEAN_MESH: number;
        readonly eDISABLE_ACTIVE_EDGES_PRECOMPUTE: number;
        readonly eFORCE_32BIT_INDICES: number;
        readonly eENABLE_INERTIA: number;
    };
    type PxPairFilteringModeEnum = number;
    const PxPairFilteringModeEnum: {
        readonly eKEEP: number;
        readonly eSUPPRESS: number;
        readonly eKILL: number;
        readonly eDEFAULT: number;
    };
    type PxPairFlagEnum = number;
    const PxPairFlagEnum: {
        readonly eSOLVE_CONTACT: number;
        readonly eMODIFY_CONTACTS: number;
        readonly eNOTIFY_TOUCH_FOUND: number;
        readonly eNOTIFY_TOUCH_PERSISTS: number;
        readonly eNOTIFY_TOUCH_LOST: number;
        readonly eNOTIFY_TOUCH_CCD: number;
        readonly eNOTIFY_THRESHOLD_FORCE_FOUND: number;
        readonly eNOTIFY_THRESHOLD_FORCE_PERSISTS: number;
        readonly eNOTIFY_THRESHOLD_FORCE_LOST: number;
        readonly eNOTIFY_CONTACT_POINTS: number;
        readonly eDETECT_DISCRETE_CONTACT: number;
        readonly eDETECT_CCD_CONTACT: number;
        readonly ePRE_SOLVER_VELOCITY: number;
        readonly ePOST_SOLVER_VELOCITY: number;
        readonly eCONTACT_EVENT_POSE: number;
        readonly eNEXT_FREE: number;
        readonly eCONTACT_DEFAULT: number;
        readonly eTRIGGER_DEFAULT: number;
    };
    type PxPrismaticJointFlagEnum = number;
    const PxPrismaticJointFlagEnum: {
        readonly eLIMIT_ENABLED: number;
    };
    type PxPruningStructureTypeEnum = number;
    const PxPruningStructureTypeEnum: {
        readonly eNONE: number;
        readonly eDYNAMIC_AABB_TREE: number;
        readonly eSTATIC_AABB_TREE: number;
    };
    type PxPvdInstrumentationFlagEnum = number;
    const PxPvdInstrumentationFlagEnum: {
        readonly eDEBUG: number;
        readonly ePROFILE: number;
        readonly eMEMORY: number;
        readonly eALL: number;
    };
    type PxPvdSceneFlagEnum = number;
    const PxPvdSceneFlagEnum: {
        readonly eTRANSMIT_CONTACTS: number;
        readonly eTRANSMIT_SCENEQUERIES: number;
        readonly eTRANSMIT_CONSTRAINTS: number;
    };
    type PxQueryFlagEnum = number;
    const PxQueryFlagEnum: {
        readonly eSTATIC: number;
        readonly eDYNAMIC: number;
        readonly ePREFILTER: number;
        readonly ePOSTFILTER: number;
        readonly eANY_HIT: number;
        readonly eNO_BLOCK: number;
    };
    type PxQueryHitType = number;
    const PxQueryHitType: {
        readonly eNONE: number;
        readonly eBLOCK: number;
        readonly eTOUCH: number;
    };
    type PxRevoluteJointFlagEnum = number;
    const PxRevoluteJointFlagEnum: {
        readonly eLIMIT_ENABLED: number;
        readonly eDRIVE_ENABLED: number;
        readonly eDRIVE_FREESPIN: number;
    };
    type PxRigidBodyFlagEnum = number;
    const PxRigidBodyFlagEnum: {
        readonly eKINEMATIC: number;
        readonly eUSE_KINEMATIC_TARGET_FOR_SCENE_QUERIES: number;
        readonly eENABLE_CCD: number;
        readonly eENABLE_CCD_FRICTION: number;
        readonly eENABLE_POSE_INTEGRATION_PREVIEW: number;
        readonly eENABLE_SPECULATIVE_CCD: number;
        readonly eENABLE_CCD_MAX_CONTACT_IMPULSE: number;
        readonly eRETAIN_ACCELERATIONS: number;
    };
    type PxRigidDynamicLockFlagEnum = number;
    const PxRigidDynamicLockFlagEnum: {
        readonly eLOCK_LINEAR_X: number;
        readonly eLOCK_LINEAR_Y: number;
        readonly eLOCK_LINEAR_Z: number;
        readonly eLOCK_ANGULAR_X: number;
        readonly eLOCK_ANGULAR_Y: number;
        readonly eLOCK_ANGULAR_Z: number;
    };
    type PxSceneFlagEnum = number;
    const PxSceneFlagEnum: {
        readonly eENABLE_ACTIVE_ACTORS: number;
        readonly eENABLE_CCD: number;
        readonly eDISABLE_CCD_RESWEEP: number;
        readonly eENABLE_PCM: number;
        readonly eDISABLE_CONTACT_REPORT_BUFFER_RESIZE: number;
        readonly eDISABLE_CONTACT_CACHE: number;
        readonly eREQUIRE_RW_LOCK: number;
        readonly eENABLE_STABILIZATION: number;
        readonly eENABLE_AVERAGE_POINT: number;
        readonly eEXCLUDE_KINEMATICS_FROM_ACTIVE_ACTORS: number;
        readonly eENABLE_GPU_DYNAMICS: number;
        readonly eENABLE_ENHANCED_DETERMINISM: number;
        readonly eENABLE_FRICTION_EVERY_ITERATION: number;
        readonly eENABLE_DIRECT_GPU_API: number;
        readonly eMUTABLE_FLAGS: number;
    };
    type PxSceneQueryUpdateModeEnum = number;
    const PxSceneQueryUpdateModeEnum: {
        readonly eBUILD_ENABLED_COMMIT_ENABLED: number;
        readonly eBUILD_ENABLED_COMMIT_DISABLED: number;
        readonly eBUILD_DISABLED_COMMIT_DISABLED: number;
    };
    type PxSdfBitsPerSubgridPixelEnum = number;
    const PxSdfBitsPerSubgridPixelEnum: {
        readonly e8_BIT_PER_PIXEL: number;
        readonly e16_BIT_PER_PIXEL: number;
        readonly e32_BIT_PER_PIXEL: number;
    };
    type PxShapeFlagEnum = number;
    const PxShapeFlagEnum: {
        readonly eSIMULATION_SHAPE: number;
        readonly eSCENE_QUERY_SHAPE: number;
        readonly eTRIGGER_SHAPE: number;
        readonly eVISUALIZATION: number;
    };
    type PxSolverTypeEnum = number;
    const PxSolverTypeEnum: {
        readonly ePGS: number;
        readonly eTGS: number;
    };
    type PxSphericalJointFlagEnum = number;
    const PxSphericalJointFlagEnum: {
        readonly eLIMIT_ENABLED: number;
    };
    type PxTetrahedronMeshAnalysisResultEnum = number;
    const PxTetrahedronMeshAnalysisResultEnum: {
        readonly eVALID: number;
        readonly eDEGENERATE_TETRAHEDRON: number;
        readonly eMESH_IS_PROBLEMATIC: number;
        readonly eMESH_IS_INVALID: number;
    };
    type PxTetrahedronMeshFlagEnum = number;
    const PxTetrahedronMeshFlagEnum: {
        readonly e16_BIT_INDICES: number;
    };
    type PxTetrahedronMeshFormatEnum = number;
    const PxTetrahedronMeshFormatEnum: {
        readonly eTET_MESH: number;
        readonly eHEX_MESH: number;
    };
    type PxTriangleMeshAnalysisResultEnum = number;
    const PxTriangleMeshAnalysisResultEnum: {
        readonly eVALID: number;
        readonly eZERO_VOLUME: number;
        readonly eOPEN_BOUNDARIES: number;
        readonly eSELF_INTERSECTIONS: number;
        readonly eINCONSISTENT_TRIANGLE_ORIENTATION: number;
        readonly eCONTAINS_ACUTE_ANGLED_TRIANGLES: number;
        readonly eEDGE_SHARED_BY_MORE_THAN_TWO_TRIANGLES: number;
        readonly eCONTAINS_DUPLICATE_POINTS: number;
        readonly eCONTAINS_INVALID_POINTS: number;
        readonly eREQUIRES_32BIT_INDEX_BUFFER: number;
        readonly eTRIANGLE_INDEX_OUT_OF_RANGE: number;
        readonly eMESH_IS_PROBLEMATIC: number;
        readonly eMESH_IS_INVALID: number;
    };
    type PxTriangleMeshFlagEnum = number;
    const PxTriangleMeshFlagEnum: {
        readonly e16_BIT_INDICES: number;
        readonly eADJACENCY_INFO: number;
    };
    type PxTriggerPairFlagEnum = number;
    const PxTriggerPairFlagEnum: {
        readonly eREMOVED_SHAPE_TRIGGER: number;
        readonly eREMOVED_SHAPE_OTHER: number;
        readonly eNEXT_FREE: number;
    };
    type PxVehicleAxesEnum = number;
    const PxVehicleAxesEnum: {
        readonly ePosX: number;
        readonly eNegX: number;
        readonly ePosY: number;
        readonly eNegY: number;
        readonly ePosZ: number;
        readonly eNegZ: number;
    };
    type PxVehicleClutchAccuracyModeEnum = number;
    const PxVehicleClutchAccuracyModeEnum: {
        readonly eESTIMATE: number;
        readonly eBEST_POSSIBLE: number;
    };
    type PxVehicleCommandNonLinearResponseParamsEnum = number;
    const PxVehicleCommandNonLinearResponseParamsEnum: {
        readonly eMAX_NB_COMMAND_VALUES: number;
    };
    type PxVehicleCommandValueResponseTableEnum = number;
    const PxVehicleCommandValueResponseTableEnum: {
        readonly eMAX_NB_SPEED_RESPONSES: number;
    };
    type PxVehicleDirectDriveTransmissionCommandStateEnum = number;
    const PxVehicleDirectDriveTransmissionCommandStateEnum: {
        readonly eREVERSE: number;
        readonly eNEUTRAL: number;
        readonly eFORWARD: number;
    };
    type PxVehicleEngineDriveTransmissionCommandStateEnum = number;
    const PxVehicleEngineDriveTransmissionCommandStateEnum: {
        readonly eAUTOMATIC_GEAR: number;
    };
    type PxVehicleGearboxParamsEnum = number;
    const PxVehicleGearboxParamsEnum: {
        readonly eMAX_NB_GEARS: number;
    };
    type PxVehicleLimitsEnum = number;
    const PxVehicleLimitsEnum: {
        readonly eMAX_NB_WHEELS: number;
        readonly eMAX_NB_AXLES: number;
    };
    type PxVehiclePhysXActorUpdateModeEnum = number;
    const PxVehiclePhysXActorUpdateModeEnum: {
        readonly eAPPLY_VELOCITY: number;
        readonly eAPPLY_ACCELERATION: number;
    };
    type PxVehiclePhysXConstraintLimitsEnum = number;
    const PxVehiclePhysXConstraintLimitsEnum: {
        readonly eNB_DOFS_PER_PXCONSTRAINT: number;
        readonly eNB_DOFS_PER_WHEEL: number;
        readonly eNB_WHEELS_PER_PXCONSTRAINT: number;
        readonly eNB_CONSTRAINTS_PER_VEHICLE: number;
    };
    type PxVehiclePhysXRoadGeometryQueryTypeEnum = number;
    const PxVehiclePhysXRoadGeometryQueryTypeEnum: {
        readonly eNONE: number;
        readonly eRAYCAST: number;
        readonly eSWEEP: number;
    };
    type PxVehiclePhysXSuspensionLimitConstraintParamsDirectionSpecifierEnum = number;
    const PxVehiclePhysXSuspensionLimitConstraintParamsDirectionSpecifierEnum: {
        readonly eSUSPENSION: number;
        readonly eROAD_GEOMETRY_NORMAL: number;
        readonly eNONE: number;
    };
    type PxVehicleSimulationContextTypeEnum = number;
    const PxVehicleSimulationContextTypeEnum: {
        readonly eDEFAULT: number;
        readonly ePHYSX: number;
    };
    type PxVehicleSuspensionJounceCalculationTypeEnum = number;
    const PxVehicleSuspensionJounceCalculationTypeEnum: {
        readonly eRAYCAST: number;
        readonly eSWEEP: number;
    };
    type PxVehicleTireDirectionModesEnum = number;
    const PxVehicleTireDirectionModesEnum: {
        readonly eLONGITUDINAL: number;
        readonly eLATERAL: number;
    };
    type PxVisualizationParameterEnum = number;
    const PxVisualizationParameterEnum: {
        readonly eSCALE: number;
        readonly eWORLD_AXES: number;
        readonly eBODY_AXES: number;
        readonly eBODY_MASS_AXES: number;
        readonly eBODY_LIN_VELOCITY: number;
        readonly eBODY_ANG_VELOCITY: number;
        readonly eCONTACT_POINT: number;
        readonly eCONTACT_NORMAL: number;
        readonly eCONTACT_ERROR: number;
        readonly eCONTACT_FORCE: number;
        readonly eACTOR_AXES: number;
        readonly eCOLLISION_AABBS: number;
        readonly eCOLLISION_SHAPES: number;
        readonly eCOLLISION_AXES: number;
        readonly eCOLLISION_COMPOUNDS: number;
        readonly eCOLLISION_FNORMALS: number;
        readonly eCOLLISION_EDGES: number;
        readonly eCOLLISION_STATIC: number;
        readonly eCOLLISION_DYNAMIC: number;
        readonly eJOINT_LOCAL_FRAMES: number;
        readonly eJOINT_LIMITS: number;
        readonly eCULL_BOX: number;
        readonly eMBP_REGIONS: number;
        readonly eSIMULATION_MESH: number;
        readonly eSDF: number;
        readonly eNUM_VALUES: number;
        readonly eFORCE_DWORD: number;
    };
}
