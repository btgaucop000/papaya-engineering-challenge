import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmptyObject,
  IsObject,
  IsEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

export class EmptyDto {
  @IsEmpty()
  _noInput?: never;
}

export class RequiredDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  type!: string;

  @IsBoolean()
  required!: boolean;

  @IsBoolean()
  present!: boolean;

  @IsBoolean()
  valid!: boolean;
}

export class SetDocumentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RequiredDocumentDto)
  documents!: RequiredDocumentDto[];
}

export class AssignAssessorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  assessorId!: string;
}

export class CompleteAssessmentDto {
  @IsObject()
  @IsNotEmptyObject()
  report!: Record<string, unknown>;
}

export class RecordAdditionalInformationDto {
  @IsBoolean()
  isValid!: boolean;

  @IsObject()
  metadata!: Record<string, unknown>;
}

export class ConfirmPaymentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  paymentReference!: string;
}

export class TransitionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  transitionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  reason?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1_000)
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1_000)
  missingInfoDescription?: string;
}
