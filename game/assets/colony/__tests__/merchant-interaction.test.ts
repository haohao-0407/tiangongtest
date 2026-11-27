import { describe, expect, it } from 'vitest';
import { pickMerchant } from '../merchant-interaction.ts';
import type { MerchantHousing, MerchantId, Position } from '../contracts.ts';
import { housingTerms } from '../guide-housing.ts';

function person(npcId:MerchantId, position:Position):MerchantHousing {
  return {npcId,position,status:'camp',roomId:null,bedId:null,...housingTerms(0,0)};
}

describe('近身商人命中',()=>{
  const player:Position=[0,0,0], eye:Position=[0,1,-5], forward:Position=[0,0,1];
  it('命中近处本人，只取射线上最靠前的人',()=>{
    const back=person('chef',[0,0,2]),front=person('tailor',[0,0,0]);
    expect(pickMerchant([back,front],player,eye,forward,20)).toBe('tailor');
    expect(pickMerchant([front,back],player,eye,forward,20)).toBe('tailor');
  });
  it('不能越过遮挡、隔层、远程或点空地选人',()=>{
    const guide=person('guide',[0,0,0]);
    expect(pickMerchant([guide],player,eye,forward,4)).toBeNull();
    expect(pickMerchant([guide],[0,4,0],eye,forward,20)).toBeNull();
    expect(pickMerchant([guide],[4,0,0],eye,forward,20)).toBeNull();
    expect(pickMerchant([guide],player,[1,1,-5],forward,20)).toBeNull();
  });
});
