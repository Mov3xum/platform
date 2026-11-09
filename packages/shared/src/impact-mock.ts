import {
  IMPACT_LEVEL_LABELS,
  type ImpactDashboard,
  type ImpactLevel,
  type ImpactMateriality,
  type ImpactSufficiency,
  type ImpactUpdateAnalysis
} from './impact-navigator';
import type {
  ImpactFinalAnalysisAIInput,
  ImpactMaterialityAIInput,
  ImpactSufficiencyAIInput,
  ImpactUpdateAnalysisAIInput
} from './impact-inputs';

/**
 * Impact Navigator — mockläget (CLAUDE.md § 56), porterat ordagrant från
 * originalets `src/lib/ai/mock.ts`. Deterministiska svar utan modellanrop så
 * flödet går att köra lokalt, i tester och på en instans utan MISTRAL_API_KEY
 * (utanför produktion). Utdata går genom SAMMA normaliserare som ett riktigt
 * modellsvar — mocken är ett svar, inte en bakväg in i databasen.
 */

function lower(input: string) {
  return input.toLowerCase();
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function mockImpactMateriality(input: ImpactMaterialityAIInput): ImpactMateriality {
  const text = lower(`${input.company.industry} ${input.company.businessDescription} ${input.initialEvidence.map((item) => item.text).join(' ')}`);
  const isAi = text.includes('ai') || text.includes('mjukvara') || text.includes('saas');
  const isIndustry = text.includes('industri') || text.includes('material') || text.includes('produktion');
  const isHealth = text.includes('health') || text.includes('life') || text.includes('vård') || text.includes('patient');

  const selectedAspects: ImpactMateriality['selectedAspects'] = [];

  if (isIndustry) {
    selectedAspects.push({
      code: 'E5',
      name: 'Resursanvändning och cirkularitet',
      category: 'ENVIRONMENT',
      status: 'MATERIAL',
      materialityStrength: 5,
      materialityDrivers: ['IMPACT', 'VALUE_CHAIN', 'OPPORTUNITY'],
      underlyingAspects: ['Materialval', 'Cirkularitet', 'Leverantörskedja'],
      rationale:
        'Resursanvändning och cirkularitet handlar om hur material väljs, används och kan återföras eller minska spill. Området bedöms vara väsentligt eftersom bolagets lösning verkar vara beroende av materialflöden mellan produkt, produktion och leverantörer.',
      startupSpecificReason: 'I en tidig fas är materialval, pilotproduktion och leverantörsval viktiga vägval som kan påverka bolagets framtida hållbarhetsprofil.',
      futureDevelopmentRelevance: 'Om bolaget skalar blir resurseffektivitet, spårbarhet och återvinningsbarhet centrala för både kostnad, klimatpåverkan och trovärdighet.',
      evidence: [{ documentName: null, note: 'Bransch och beskrivning pekar mot materialintensiv utveckling.', excerpt: null }],
      confidence: 'MEDIUM',
      uncertaintyNotes: ['Underlaget beskriver inte leverantörsled eller produktionsupplägg i detalj.']
    });
  } else {
    selectedAspects.push({
      code: 'E1',
      name: 'Klimatförändringar',
      category: 'ENVIRONMENT',
      status: isAi ? 'MATERIAL' : 'UNCERTAIN',
      materialityStrength: isAi ? 4 : 3,
      materialityDrivers: ['RISK', 'OPPORTUNITY', 'VALUE_CHAIN'],
      underlyingAspects: isAi ? ['Digital infrastruktur', 'Energianvändning', 'Datacenterpåverkan'] : ['Energianvändning', 'Klimatpåverkan vid skalning'],
      rationale:
        'Klimatförändringar handlar om hur bolagets lösning påverkar eller påverkas av energi, drift, transporter och andra utsläppskällor. Området bedöms vara väsentligt eftersom bolagets produkt, teknik och värdekedja har en direkt koppling till energibehov och utsläppskällor.',
      startupSpecificReason: 'Tidiga teknik- och affärsmodellval kan göra det lättare att styra mot lägre klimatpåverkan när kundbasen växer.',
      futureDevelopmentRelevance:
        'Om lösningen får många användare eller kräver betydande digital infrastruktur behöver klimatpåverkan följas utan att det blir ett tungt rapporteringskrav.',
      evidence: [{ documentName: null, note: 'Bedömningen bygger på bransch, affärsidé och känd skalningslogik.', excerpt: null }],
      confidence: 'MEDIUM',
      uncertaintyNotes: ['Det saknas konkret information om teknikstack och framtida driftvolymer.']
    });
  }

  selectedAspects.push({
    code: isHealth ? 'S4' : 'G1',
    name: isHealth ? 'Konsumenter och slutanvändare' : 'Affärsetik och bolagsstyrning',
    category: isHealth ? 'SOCIAL' : 'GOVERNANCE',
    status: 'MATERIAL',
    materialityStrength: 4,
    materialityDrivers: ['RISK', 'USER_IMPACT', 'REGULATORY'],
    underlyingAspects: isHealth
      ? ['Patientsäkerhet', 'Dataskydd', 'Ansvarsfull automatisering', 'Tillgänglighet']
      : ['Dataskydd', 'Informationssäkerhet', 'Ansvarsfull automatisering', 'Transparens'],
    rationale: isHealth
      ? 'Konsumenter och slutanvändare handlar om hur lösningen påverkar personer som använder eller berörs av produkten. Området bedöms vara väsentligt eftersom hälsorelaterade lösningar har en direkt koppling till användares trygghet, tillgänglighet och beslut.'
      : 'Affärsetik och bolagsstyrning handlar om ansvar, datahantering, transparens och förtroende i hur bolaget utvecklar och erbjuder sin lösning. Området bedöms vara väsentligt eftersom digitala och datadrivna affärsmodeller ofta bygger på information och relationer där tydliga principer påverkar kundernas förtroende.',
    startupSpecificReason: 'Det är rimligt att diskutera principer, ansvar och riskförståelse tidigt även om bolaget ännu saknar formella policys.',
    futureDevelopmentRelevance: 'När bolaget växer kan förtroende, regulatoriska krav och incidenthantering bli avgörande för kundrelationer och skalbarhet.',
    evidence: [{ documentName: null, note: 'Underlaget indikerar digital eller datadriven produktlogik.', excerpt: null }],
    confidence: 'MEDIUM',
    uncertaintyNotes: ['Det saknas fullständig beskrivning av dataflöden, användare och ansvarsfördelning.']
  });

  return {
    companySummary: `${input.company.name} är i fasen ${input.company.phase} och verkar inom ${input.company.industry}. Underlaget visar en tidig affärsidé där de viktigaste hållbarhetsfrågorna handlar om hur modellen utvecklas vid skalning.`,
    sustainabilityPerspectiveSummary: 'Bedömningen fokuserar på framtida konsekvenser, risker och möjligheter snarare än på om bolaget redan har mogna processer eller rapporter.',
    materialityApproach: 'Områdena har valts restriktivt utifrån branschlogik, affärsmodell, sannolik värdekedja och frågor som Movexum bör diskutera med bolaget.',
    selectedAspects,
    consideredButNotMaterial: [
      {
        code: 'E3',
        name: 'Vatten och marina resurser',
        category: 'ENVIRONMENT',
        rationale: 'Inget i underlaget pekar på direkt vattenberoende, men indirekt vattenpåverkan kan bli relevant om digital infrastruktur eller produktion växer.'
      },
      {
        code: 'S2',
        name: 'Arbetstagare i värdekedjan',
        category: 'SOCIAL',
        rationale: 'Området är inte prioriterat i nuläget, men bör omprövas om bolaget får mer omfattande leverantörsled eller hårdvaruproduktion.'
      }
    ],
    assumptions: ['Bolaget är i tidig fas och saknar sannolikt fullständig mätdata.', 'Bedömningen bygger på affärsidéns sannolika utveckling, inte bevisad effekt.'],
    warnings: ['Detta är inte en formell CSRD-, VSME- eller juridisk compliance-bedömning.']
  };
}

export function mockImpactSufficiency(input: ImpactSufficiencyAIInput): ImpactSufficiency {
  const hasGoodEvidence = input.materiality.selectedAspects.some((aspect) => aspect.evidence.length > 0 && aspect.confidence !== 'LOW') || input.newEvidence.length > 0;
  const isEarlyPhase = input.phase === 'SCREENING' || input.phase === 'BOOST_CHAMBER';
  const aspectChecks: ImpactSufficiency['aspectChecks'] = input.materiality.selectedAspects.map((aspect) => {
    const partial = input.newEvidence.length > 0 || aspect.evidence.length > 0 || aspect.confidence === 'HIGH';
    const topic = aspect.underlyingAspects[0]?.toLowerCase() ?? 'detta område';
    return {
      code: aspect.code,
      name: aspect.name,
      category: aspect.category,
      informationStatus: partial ? 'PARTIAL' : 'MISSING',
      rationale: partial
        ? 'Det finns viss information om affärsidén, men flera viktiga vägval är fortfarande otydliga.'
        : 'Underlaget är för begränsat för att göra mer än en försiktig bedömning.',
      whatWeKnow: [aspect.startupSpecificReason],
      missingInformation: ['Hur bolaget tänker hantera området när produkten, kundbasen eller värdekedjan växer.'],
      question: {
        question: isEarlyPhase
          ? `Vad vet ni redan idag om ${topic}, och vilka antaganden vill ni testa i nästa steg?`
          : `Vilka erfarenheter, resultat eller kundinsikter har ni hittills kring ${topic}, och vad är fortfarande osäkert inför nästa steg?`,
        missingInformation: 'Det saknas konkreta exempel på vad bolaget redan vet, har sett, lärt sig eller vill testa inom området.',
        whyThisMattersForFinalAssessment: 'Svaret hjälper Movexum att skilja mellan tidiga antaganden, faktiska erfarenheter och frågor som behöver följas upp i coachningen.',
        severity: 'RECOMMENDED',
        exampleHelpfulEvidence: isEarlyPhase
          ? 'Kort fritext, grundarnas antaganden, kundsamtal, planerade tester eller relevanta utdrag ur pitchdeck.'
          : 'Kort fritext, användarfeedback, pilotlärdomar, kundinsikter eller relevanta utdrag ur pitchdeck.'
      },
      confidence: 'MEDIUM'
    };
  });

  return {
    readyForFinalAnalysis: true,
    overallInformationQuality: hasGoodEvidence ? 62 : 46,
    generalComment: 'Det finns tillräckligt underlag för en första analys, men dashboarden bör tydligt markera antaganden och osäkerheter.',
    aspectChecks,
    generalMissingInformation: ['Mer konkret beskrivning av skalning, kunder, värdekedja och ansvarsfördelning skulle stärka analysen.'],
    userMessage: 'Du kan komplettera där det finns frågor, men det går också att gå vidare med lägre informationskvalitet.'
  };
}

export function mockImpactFinalAnalysis(input: ImpactFinalAnalysisAIInput): ImpactDashboard {
  const supplemented = (response: ImpactFinalAnalysisAIInput['gapResponses'][number]) => (response.answer?.length ?? 0) > 20 || response.hasReadableDocumentEvidence;
  const hasSupplements = input.gapResponses.some(supplemented);
  const supplementedAreaCodes = [...new Set(input.gapResponses.filter(supplemented).map((response) => response.areaCode))];
  const aspects = input.materiality.selectedAspects;
  const potentialSignal = clampPercentage(aspects.reduce((sum, aspect) => sum + aspect.materialityStrength * 16, 0) / Math.max(1, aspects.length));
  const firstAspect = aspects[0];
  const hasEnvironmentalAspect = aspects.some((aspect) => aspect.category === 'ENVIRONMENT');
  const hasSocialAspect = aspects.some((aspect) => aspect.category === 'SOCIAL');
  const hasGovernanceAspect = aspects.some((aspect) => aspect.category === 'GOVERNANCE');
  const impactLevel: ImpactLevel = potentialSignal >= 80 ? 'IMPACT_DRIVEN' : potentialSignal >= 62 ? 'SUSTAINABILITY_DRIVEN' : 'RESPONSIBLE';
  const overallPotential = IMPACT_LEVEL_LABELS[impactLevel];

  return {
    executiveSummary: `${input.company.name} har en tydlig möjlighet att bygga hållbarhet in i affärsutvecklingen, men analysen behöver läsas som ett första beslutsstöd. Potentialen ligger främst i hur lösningen kan skala med lägre negativ påverkan och högre nytta för kunder eller användare. Den största svagheten är att flera framtida vägval ännu inte är konkretiserade.${hasSupplements ? ` Kompletterande svar eller dokument för ${supplementedAreaCodes.join(', ')} har vägts in i bedömningen.` : ''}`,
    companySustainabilityDescription:
      'Bolaget bör bedömas utifrån affärsmodellens framtida konsekvenser snarare än dagens interna hållbarhetsmognad. Fokus ligger på värdekedja, användarpåverkan, data, automatisering och trovärdig kommunikation.',
    businessModelCompatibility: {
      status: 'COMPATIBLE_WITH_LONG_TERM_SUSTAINABILITY',
      rationale: 'Inget i underlaget visar att kärnaffären i sig bygger på betydande negativ påverkan, men vissa risker behöver hanteras tidigt.',
      consequencesIfScaled: 'Om bolaget skalar utan tydliga principer kan positiva effekter försvagas av datarisker, energiberoenden eller otydlig ansvarsfördelning.'
    },
    impactLevel: {
      level: impactLevel,
      labelSv: overallPotential,
      rationale: 'Affärsidén har hållbarhetsrelevant potential, men nivån beror på om bolaget kan omsätta den i konkreta val och validerad kundnytta.'
    },
    areaAssessments: {
      overall: {
        potentialLabel: overallPotential,
        assessment: `${input.company.name} bedöms ha potential att utvecklas till ett hållbarhets- eller impactdrivande bolag om de tidiga vägvalen kopplas tydligt till kundnytta, riskförståelse och faktisk effekt. Affärsidén verkar inte bygga på uppenbart negativ påverkan, men bolaget befinner sig fortfarande i en fas där antaganden behöver testas. Den viktigaste coachningsfrågan är hur teamet kan göra den positiva potentialen mer verifierbar utan att fastna i mogna rapporteringskrav.`,
        uncertaintyNotes: []
      },
      environment: {
        potentialLabel: hasEnvironmentalAspect ? 'Ansvarsfull → Hållbarhetsdrivande' : 'Ansvarsfull',
        assessment: hasEnvironmentalAspect
          ? 'Den miljömässiga påverkan bedöms främst uppstå genom teknikval, drift, material, leverantörer eller kundernas effektivisering när lösningen skalar. Bolaget kan stärka sin miljöprofil genom att tidigt välja resurssnåla arbetssätt och beskriva vilka miljöeffekter lösningen faktiskt kan påverka hos kund. Potentialen är tydligast om klimat- eller resursnyttan kan kopplas till enkla indikatorer i pilot eller kunddialog.'
          : 'Den direkta miljöpåverkan framstår som begränsad utifrån dagens underlag. Om bolaget växer kan miljöfrågorna ändå bli relevanta genom digital drift, inköp, resor, materialval eller kundernas användning av lösningen. Miljöområdet bör därför behandlas som ett ansvarsfullt vägval snarare än som ett rapporteringskrav i nuläget.',
        uncertaintyNotes: ['Det saknas detaljer om framtida drift, leverantörer, materialflöden eller kundernas faktiska miljönytta.']
      },
      social: {
        potentialLabel: hasSocialAspect ? 'Impactdrivande potential' : 'Ansvarsfull → Hållbarhetsdrivande',
        assessment: hasSocialAspect
          ? 'Den sociala nyttan är central om lösningen förbättrar trygghet, tillgänglighet, arbetsmiljö, hälsa eller användarnas beslut i praktiken. För att bli tydligt impactdrivande behöver bolaget visa vilka människor som påverkas, vilken förbättring de upplever och hur risken för negativa bieffekter hanteras. Tidiga användarinsikter, feedback och exempel på förändrade arbetssätt är mer relevanta än formella policydokument i detta skede.'
          : 'Den sociala påverkan är inte fullt utvecklad i underlaget, men kan bli viktig genom användarupplevelse, dataskydd, tillgänglighet, arbetsmiljö eller kundernas förtroende. Bolaget bör tidigt beskriva vem som påverkas av lösningen och vilka praktiska problem den minskar. Om detta kan valideras finns möjlighet att utveckla en starkare social hållbarhetsprofil.',
        uncertaintyNotes: ['Det saknas tydlig information om användargrupper, tidig feedback och eventuella negativa sociala konsekvenser.']
      },
      governance: {
        potentialLabel: hasGovernanceAspect ? 'Ansvarsfull → Hållbarhetsdrivande' : 'Ansvarsfull',
        assessment:
          'Styrning och ansvar handlar i den här fasen främst om tydliga principer för data, transparens, kundlöften, riskhantering och vem som ansvarar för viktiga beslut. Bolaget behöver inte ha mogna policies, men bör kunna visa hur de resonerar när lösningen får fler kunder eller större påverkan. Om ansvarsfördelning och trovärdig kommunikation byggs in tidigt kan området bli en styrka i affärsutvecklingen.',
        uncertaintyNotes: ['Underlaget beskriver ännu begränsat hur ansvar, transparens och riskbeslut ska hanteras när bolaget växer.']
      }
    },
    informationQualityComment: hasSupplements ? 'Kompletterat underlag, men vissa antaganden återstår.' : 'Första bedömning möjlig, men antaganden återstår.',
    whatCompanyNeedsToWorkOn: [
      {
        title: 'Beskriv riskprinciper tidigt',
        description: 'Bolaget bör formulera hur de vill fatta vägval kring de mest väsentliga hållbarhetsfrågorna när lösningen skalar.',
        priority: 'HIGH',
        realisticStartupNextStep: 'Skriv en sida med principer för teknikval, kundnytta, ansvar och risker inför nästa coachmöte.'
      },
      {
        title: 'Knyt potential till bevis',
        description: 'Den positiva effekten behöver kopplas till kundproblem, mätbara proxyindikatorer eller validerad användarnytta.',
        priority: 'MEDIUM',
        realisticStartupNextStep: 'Välj 2-3 enkla indikatorer som kan följas i pilot eller kunddialog.'
      }
    ],
    risks: [
      {
        aspectCode: firstAspect?.code ?? 'G1',
        category: firstAspect?.category ?? 'GOVERNANCE',
        title: 'Potential utan tillräcklig riskstyrning',
        description: 'Bolaget kan ha hög positiv potential men ännu sakna tydlig bild av vilka risker som växer med affären.',
        severity: 'HIGH',
        timeHorizon: 'MEDIUM',
        whyImportant: 'Obalansen kan påverka förtroende, kundkrav, investerardialog och framtida regelefterlevnad.',
        howItCanAffectFutureDevelopment: 'Om frågorna hanteras sent kan bolaget behöva ändra teknik, processer eller kommunikation under press.',
        mitigationSuggestion: 'Använd materialitetsområdena som agenda i produkt- och affärsutveckling, inte som rapporteringschecklista.',
        evidence: ['Underlaget innehåller begränsad information om framtida riskhantering.']
      }
    ],
    opportunities: [
      {
        aspectCode: firstAspect?.code ?? 'E1',
        category: firstAspect?.category ?? 'ENVIRONMENT',
        title: 'Bygga in hållbarhet i skalningsval',
        description: 'Tidiga beslut om teknik, kunder, leverantörer och kommunikation kan stärka både impact och affärsnytta.',
        potential: 'HIGH',
        whyImportant: 'Startupfasen ger möjlighet att forma affärsmodellen innan dyra strukturer låser sig.',
        howCompanyCanUseIt: 'Bolaget kan använda hållbarhetsfrågorna för bättre prioriteringar i pilot, produktutveckling och kunddialog.',
        recommendedAction: 'Koppla varje väsentligt område till ett konkret beslut som teamet behöver fatta de kommande 3-6 månaderna.',
        evidence: ['Affärsidén är tidig och vägvalen är fortfarande påverkbara.']
      }
    ],
    discussionQuestions: [
      {
        question: 'Vilka beslut de kommande 3-6 månaderna tror ni får störst betydelse för bolagets hållbarhetspåverkan när ni växer?',
        whyImportant: 'Frågan hjälper teamet att prioritera tidiga vägval som fortfarande går att påverka.'
      },
      {
        question: 'Vilken feedback eller vilka resultat från pilot, kunder eller användare skulle visa att lösningen faktiskt skapar nytta?',
        whyImportant: 'Det minskar risken för breda påståenden utan stöd och gör nyttan lättare att följa upp.'
      },
      {
        question: 'Vad har ni redan märkt kan bli svårare att hantera om ni snabbt får fler kunder, användare eller leverantörer?',
        whyImportant: 'Svaret gör det lättare att se praktiska risker innan de växer med bolaget.'
      }
    ],
    greenwashingRisks: [
      {
        claimOrRisk: 'Att kommunicera stark impact innan effekten är validerad.',
        whyRisky: 'Tidiga antaganden kan misstolkas som bevisad samhälls- eller miljönytta.',
        howToSubstantiate: 'Använd försiktiga formuleringar och koppla påståenden till pilotdata, kundcase eller tydliga antaganden.'
      }
    ],
    assumptions: ['Bolaget är i tidig fas och har begränsad verifierbar data.', 'Analysen antar att affärsmodellen kan skalas ungefär enligt beskriven riktning.'],
    limitations: [
      'Analysen är inte en juridisk, finansiell, regulatorisk eller formell CSRD/VSME-bedömning.',
      'Dokument med bilder, diagram eller muntlig pitch kan innehålla information som textutdraget missar.'
    ],
    disclaimer:
      'Movexum Impact Navigator är ett vägledande analysstöd för coachning och intern prioritering. Resultatet ska inte användas som formell hållbarhetsrapport, juridisk rådgivning eller bevisad impactbedömning.'
  };
}

export function mockImpactUpdateAnalysis(input: ImpactUpdateAnalysisAIInput): ImpactUpdateAnalysis {
  const evidenceText = [input.newEvidence.narrative ?? '', ...input.newEvidence.documents.map((document) => document.text)].join(' ');
  const hasNewEvidence = evidenceText.trim().length > 0;
  const current = input.currentAnalysis as ImpactDashboard;
  if (!hasNewEvidence) {
    return {
      updatedDashboard: current,
      deltaSummary: {
        whatChangedSinceLastAssessment: [],
        newRisks: [],
        reducedRisks: [],
        newOpportunities: [],
        changedAreaAssessments: [],
        recommendedNextDiscussions: []
      }
    };
  }

  const evidenceSummary = input.newEvidence.narrative ? input.newEvidence.narrative.slice(0, 180) : input.newEvidence.documents.map((document) => document.sourceLabel).join(', ');
  const governanceChanged = /ansvar|styrning|data|etik|transparens/i.test(evidenceText);
  const scalingChanged = /skal|expander|ny marknad|fler (kunder|användare)/i.test(evidenceText);
  const validationChanged = /pilot|kund|användar|test|feedback|resultat/i.test(evidenceText);
  const previousAreaAssessments = current.areaAssessments;
  const changedDashboard: ImpactDashboard = {
    ...current,
    executiveSummary: `${current.executiveSummary} Sedan förra versionen har bolaget lämnat ny evidens: ${evidenceSummary}.`,
    areaAssessments: {
      ...previousAreaAssessments,
      overall: {
        ...previousAreaAssessments.overall,
        assessment: `${previousAreaAssessments.overall.assessment} Uppdateringen stärker bilden av vilka vägval bolaget arbetar med, men den faktiska effekten behöver fortfarande följas genom kunddialog, pilotlärdomar eller andra tidiga bevis.`,
        uncertaintyNotes: []
      },
      governance: governanceChanged
        ? {
            ...previousAreaAssessments.governance,
            potentialLabel: 'Ansvarsfull → Hållbarhetsdrivande',
            assessment:
              'Uppdateringen ger en något tydligare bild av ansvar och prioriteringar, vilket stärker styrningsområdet som coachningsfråga. Bolaget bör nu koppla sina principer till konkreta beslut i produktutveckling, kunddialog och kommunikation. Det är fortfarande för tidigt att bedöma området som moget, men riktningen är mer genomtänkt än i föregående version.',
            uncertaintyNotes: ['Det saknas fortfarande återkommande arbetssätt eller lärdomar som visar hur principerna används i praktiken.']
          }
        : previousAreaAssessments.governance
    },
    informationQualityComment: 'Något tydligare underlag, men antaganden återstår.'
  };

  return {
    updatedDashboard: changedDashboard,
    deltaSummary: {
      whatChangedSinceLastAssessment: [
        'Bolaget har lämnat ny information om nuläge och nästa steg.',
        ...(governanceChanged ? ['Analysen bedömer att styrning och prioriteringar är något tydligare än tidigare.'] : [])
      ],
      newRisks: scalingChanged ? ['Nya beroenden kan uppstå när den beskrivna skalningen genomförs.'] : [],
      reducedRisks: governanceChanged ? ['Viss osäkerhet minskar när ansvar och vägval beskrivs mer konkret.'] : [],
      newOpportunities: validationChanged ? ['Den nya pilot- eller kundlärdomen kan användas för mer fokuserad validering.'] : [],
      changedAreaAssessments: governanceChanged
        ? [
            {
              category: 'GOVERNANCE',
              previousPotential: previousAreaAssessments.governance.potentialLabel,
              newPotential: changedDashboard.areaAssessments.governance.potentialLabel,
              reason: 'Den nya evidensen ger bättre bild av ansvar och vägval.'
            }
          ]
        : [],
      recommendedNextDiscussions: [
        'Vad har ni lärt er sedan förra bedömningen som bör påverka era viktigaste prioriteringar kommande kvartal?',
        'Vilka antaganden vill ni testa med kunder, användare eller partners innan ni fattar nästa större beslut?'
      ]
    }
  };
}
