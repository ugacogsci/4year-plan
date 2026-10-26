# Career matcher benchmark

Made by `scripts/career/benchmark.mjs` (see docs/career-system.md). An incoming freshman, the same board built with today's word matching and with the career matcher; the goal picks only (electives, and `*` a general education pick the goal ordered). Career-track courses are left out: they are booked the same way both times. "unmet" is the requirements the engine leaves unmet, plus at UGA the audit rows the board bar shows; "not placed" the required courses with no room. "The matcher ranked" says which free choices it ranked after the degree check (all, electives only, or none).

Boards: 80. Degree worse with the matcher on: 0.

## Illinois · Psychology, BSLAS · dentist

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
|  | HK 208 Introduction to Medical Ethics |
|  | GLBL 240 Global Health |

reason line: "closest to your goal (dentist): 66th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · software engineer

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| IS 205 Programming for Information Problems | IS 205 Programming for Information Problems |
| ECE 316 Ethics and Engineering | ACE 161 Computer Concepts & Applications |
| BADM 352 Database Design and Management | CS 124 Introduction to Computer Science I |
| SE 361 Emotional Intelligence Skills | GSD 103 The Basics of Game Design |
| IS 305 Programming for Information Problems II | CS 128 Introduction to Computer Science II |
| CS 107 Data Science Discovery | BCOG 200 Introduction to Programming for the Bra |
| ETMA 232 Materials and Construction Sys | CI 438 Computer Programming and the Classroom |
| SE 101 Engineering Graphics & Design | IE 405 Computing for ISE |
| NPRE 330 Materials in Nuclear Engineering | GSD 405 Introduction to the Video Game Developme |
| CS 266 Community Innovation | STAT 447 Data Science Programming Methods |
| ETMA 100 Technical Systems in Agr |  |
| STAT 385 Statistics Programming Methods |  |
| ECE 110 Introduction to Electronics |  |
| IE 340 Human Factors |  |
| CS 124 Introduction to Computer Science I |  |
| CS 128 Introduction to Computer Science II |  |
| BCOG 200 Introduction to Programming for the Bra |  |
| CHBE 101 Hidden World of Engineering |  |
| MSE 101 Materials in Today's World |  |
| CLCV 230* Ancient Engineering |  |
| ETMA 311* Humanity in the Food Web |  |
| ECE 101* Exploring Digital Information Technolog |  |

reason line: "closest to your goal (software engineer): 43rd of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · data scientist

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| STAT 200 Statistical Analysis | STAT 200 Statistical Analysis |
| HDFS 330 Statistical Reasoning for Everyday Life | BADM 356 Data Science and Analytics |
| HK 209 Introduction to Biostatistics and Health  | BADM 352 Database Design and Management |
| BADM 356 Data Science and Analytics | HDFS 330 Statistical Reasoning for Everyday Life |
| CS 107 Data Science Discovery | STAT 385 Statistics Programming Methods |
| GGIS 224 Environmental Data Science | IS 205 Programming for Information Problems |
| ACE 262 Applied Statistical Methods and Data Ana | HK 209 Introduction to Biostatistics and Health  |
| ACE 264 Applied Statistical Methods & Data Analy | UP 116 Urban Informatics I |
| STAT 385 Statistics Programming Methods | CS 107 Data Science Discovery |
| ATMS 207 Weather and Climate Data Science | CI 312 Data Literacy |
| BDI 475 Introduction to Data Analytics Applicati | IS 357 Introduction to Data Storytelling |
| IS 445 Data Visualization | STAT 207 Data Science Exploration |
| IS 407 Introduction to Data Science | GGIS 224 Environmental Data Science |
| ASRM 455 Predictive Analytics | ACE 262 Applied Statistical Methods and Data Ana |
| INFO 407 Introduction to Programming Python for  | ADV 200 Data Literacy |
| BDI 367 Data Visualization and Communication | ADV 120 Consumer Data and Society |
| HIST 103* A History of Everything: The Big Bang  | ACE 264 Applied Statistical Methods & Data Analy |
|  | BDI 475 Introduction to Data Analytics Applicati |
|  | UP 317 Introduction to Urban Data Science |
|  | ASRM 455 Predictive Analytics |

reason line: "closest to your goal (data scientist): 35th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · nurse

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| RST 316 Human Development and Recreation, Sport  | HK 264 Applied Medical Terminology for the Healt |
| HDFS 105 Intro to Human Development | SOC 274 Health, Illness and Society |
| SOC 100 Introduction to Sociology | HK 370 Interdisciplinary Health Delivery and Ear |
| HK 206 Health Care Systems | ANSC 207 The Science of Pets and How to Care for |
| SOCW 451 HBSE I: Human Development | PHIL 214 Biomedical Ethics |
| RHET 105* Writing and Research | SOCW 240 Death & Dying |
| FSHN 120* Contemporary Nutrition | CPSC 180 Medicinal Plants and Herbology |
|  | HDFS 105 Intro to Human Development |
|  | RUSS 260 Medicine & Literature |
|  | SOC 100 Introduction to Sociology |
|  | HIST 367 History of Western Medicine |
|  | HDFS 408 Hospitalized Children |
|  | GWS 409 Women's Health |
|  | CMN 462 Health Communication in Relationships |
|  | ANTH 379 Medical Anthropology |
|  | GWS 263* History of Medicine in the United State |
|  | RHET 105* Writing and Research |
|  | FSHN 120* Contemporary Nutrition |
|  | HK 201* Health Sciences Research Methods |

reason line: "closest to your goal (nurse): 7th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · lawyer

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| UP 211 Local Planning, Gov't and Law | LAW 301 Introduction to Law |
| LAW 301 Introduction to Law | LAW 303 Living the Law |
| LAW 303 Living the Law | RST 354 Legal Aspects of Sport |
| ACE 203 Introduction to Public Policy and Law | LAW 307 Law and Literature |
| LAW 307 Law and Literature | PHIL 103 Logic and Reasoning QR II |
| PHIL 103 Logic and Reasoning QR II | PS 370 Justice in the Law |
| AIS 214 American Indian Law & Politics | JOUR 311 Media Law |
| LAW 305 Art and Cultural Property Law | BADM 403 Corporate & Commercial Law |
| RST 354 Legal Aspects of Sport | SOC 375 Criminal Justice System |
| JOUR 311 Media Law | SOC 275 Criminology |
| AAS 370 Immigration, Law, and Rights | HDFS 320 Families and the Law |
| ACE 306 Food Law | SE 400 Engineering Law |
| PS 370 Justice in the Law | SOC 479 Law and Society |
| SE 400 Engineering Law | BADM 300 The Legal Environment of Bus |
| SOC 375 Criminal Justice System | PS 322 Law and Public Policy |
| SOC 275 Criminology | PS 301 The US Constitution I |
| LAW 302* Transitional Justice | LLS 372* Immigration, Law, and Rights |

reason line: "closest to your goal (lawyer): 12th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · financial analyst

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| ACE 240 Personal Financial Planning | ACE 240 Personal Financial Planning |
| FIN 230 Introduction to Insurance | ACE 262 Applied Statistical Methods and Data Ana |
| ACE 349 Risk Management and Financial Planning A | STAT 200 Statistical Analysis |
|  | ECON 103 Macroeconomic Principles |
|  | FIN 221 Corporate Finance |
|  | FIN 300 Financial Markets |
|  | ACCY 200 Fundamentals of Accounting |
|  | FIN 464 Applied Financial Analysis |
|  | BADM 403 Corporate & Commercial Law |

reason line: "closest to your goal (financial analyst): 21st of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · marketing

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| BADM 351 Social Media Strategy | ADV 250 Advertising and Brand Strategy |
| BADM 360 Digital Marketing | BADM 320 Principles of Marketing |
| BADM 320 Principles of Marketing | BADM 322 Marketing Research |
| BADM 382 International Marketing | BADM 360 Digital Marketing |
| ADV 250 Advertising and Brand Strategy | RST 325 Marketing in Recreation, Sport and Touri |
| ADV 150 Introduction to Advertising | ACE 220 Introduction to Sales: Principles and St |
| ACE 220 Introduction to Sales: Principles and St | ADV 150 Introduction to Advertising |
| ADV 214 Sports Advertising & Branding | ACE 335 Food Marketing and Behavior |
| ADV 301 Becoming an Influencer | CMN 328 Social Media and Politics |
| ACE 335 Food Marketing and Behavior | ENSU 303 Sustainable Business I |
| JOUR 102 Navigating Social Media | CMN 321 Strategies of Persuasion |
| RST 325 Marketing in Recreation, Sport and Touri | HK 423 Social Marketing and Comm in Health Educa |
| RST 301 Sport Brand Management | MACS 463 Public Relations and the Entertainment  |
| CMN 328 Social Media and Politics | ADV 175* Introduction to Multicultural Advertisi |
| GLBL 270 Introduction to Global Markets and Soci |  |
| AGCM 315 Social Media Management in Agricultural |  |
| CMN 465 Social Marketing |  |
| ADV 175* Introduction to Multicultural Advertisi |  |

reason line: "closest to your goal (marketing): 5th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · teacher

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| CI 210 Introduction to Digital Learning Environm | EPSY 201 Educational Psychology |
| SPED 322 Introduction to Intellectual Disability | HK 260 Teaching Activities I |
| SPED 117 The Culture of Disability | EDUC 201 Identity and Difference in Education |
| HK 260 Teaching Activities I | EPOL 201 Foundations of Education |
| CI 312 Data Literacy | EPSY 236 Child Development in Education |
| CI 380 History (and Futures) of Educational Tech | SPED 465 Curriculum and Methods in Early Childho |
| CI 211 Introduction to Learning | CI 435 Technology Applications for Teachers |
| SPED 465 Curriculum and Methods in Early Childho | EPOL 380* Education and Social Justice |
| ENGL 404 Engl Grammar for ESL Teachers | EDUC 202* Social Justice, School and Society |
| MUS 345 Mus Methods in Early Childhood |  |
| EDUC 201* Identity and Difference in Education |  |
| EDUC 202* Social Justice, School and Society |  |
| EPSY 201* Educational Psychology |  |

reason line: "closest to your goal (teacher): 26th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · therapist

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| PSYC 239 Community Psych | PSYC 239 Community Psych |
| PSYC 336 Topics in Clin/Comm Psych | PSYC 336 Topics in Clin/Comm Psych |
| PSYC 238 Psychopathology and Problems in Living | PSYC 216 Child Psych |
| PSYC 379 Clinical/Abnormal Psych Lab | EPSY 201 Educational Psychology |
| PSYC 250 Psych of Personality | HK 201 Health Sciences Research Methods |
| SOCW 200 Introduction to Social Work | HK 200 Mental Health Issues |
| SOCW 225 Social Work Statistics | SOCW 200 Introduction to Social Work |
| PSYC 365 Stress, Trauma and Resilience | SOC 274 Health, Illness and Society |
| SOCW 321 Social Entre & Social Change | EPSY 218 College Student Mental Health |
| SOCW 370 Social Work and Disability Studies | CMN 462 Health Communication in Relationships |
| PSYC 465 Personality and Soc Dev | GWS 409 Women's Health |
| HK 200 Mental Health Issues | HIST 236* Madness and Modern Society |
| EPSY 420 Theories of Psychotherapy | HK 300* Health Behavior Theories and Application |
| EPSY 218 College Student Mental Health |  |
| SOCW 297* Asian Families in America |  |
| SOCW 296* Diversity: Identities & Issues |  |

reason line: "closest to your goal (therapist): 13th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · environmental scientist

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| ANTH 278 Climate Change & Civilization | ACE 210 Environmental Economics & Policy |
| NRES 224 Environmental and Climate Justice | ESE 311 Environmental Issues Today |
| ESE 210 Social & Environmental Issues | UP 205 Ecology & Environmental Sustainability |
| ARCH 237 Urban Scale Sustainability | NRES 219 Applied Ecology |
| ANTH 361 Ecology and Human Health | ESE 287 Environment and Society |
| NRES 219 Applied Ecology | NRES 224 Environmental and Climate Justice |
| ENVS 210 Environmental Economics & Policy | ATMS 140 Climate and Global Change |
| UP 205 Ecology & Environmental Sustainability | ESE 210 Social & Environmental Issues |
| NRES 362 Ecology of Invasive Species | ENSU 302 Air Pollution to Global Change |
| NRES 340 Environ Social Sci Res Meth | RST 225 Environmental Politics & Policy |
| ESE 311 Environmental Issues Today | GGIS 220 Landscapes, Ecosystems and Environmenta |
| ACE 255 Economics of Food and Environmental Just | EPOL 280 Education & Climate Hope |
| ENSU 303 Sustainable Business I | ENVS 330 Environmental Communications |
| GGIS 224 Environmental Data Science | PSYC 472 Environmental Psychology |
| ESE 350 Sustainability and the City | HK 408 Environmental Health |
| PSYC 472 Environmental Psychology | ENSU 300 Environmental Sustainability |
| PS 225 Environmental Politics & Policy | ENSU 310 Renewable & Alternative Energy |
| ESE 143 History of Life | UP 186* Climate Justice |
| ATMS 140 Climate and Global Change | IB 110* Race and Environmental Biology |
| ACES 102 Intro Sustainable Food Systems | HIST 202* American Environmental History |
| ENSU 301 Soc Impacts Weather & Climate | NRES 105* Climate Change Impacts on Ecological S |
| ENSU 302 Air Pollution to Global Change |  |
| UP 136 Urban Sustainability |  |
| ESE 106* Geographies of Globalization |  |
| IB 110* Race and Environmental Biology |  |
| ESE 202* American Environmental History |  |
| ESE 360* Environmental Writing |  |
| ESE 120* Severe and Hazardous Weather |  |

reason line: "closest to your goal (environmental scientist): 17th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · mechanical engineer

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| SE 101 Engineering Graphics & Design | TAM 201 Mechanics for Technol & Mgmt |
| ECE 316 Ethics and Engineering | NPRE 330 Materials in Nuclear Engineering |
| SE 361 Emotional Intelligence Skills | GSD 103 The Basics of Game Design |
| TAM 201 Mechanics for Technol & Mgmt | SE 400 Engineering Law |
| ETMA 232 Materials and Construction Sys | HK 458 Rehabilitation Biomechanics |
| ETMA 100 Technical Systems in Agr | NPRE 402 Nuclear Power Engineering |
| ECE 110 Introduction to Electronics |  |
| NPRE 330 Materials in Nuclear Engineering |  |
| IE 340 Human Factors |  |
| CLCV 230 Ancient Engineering |  |
| CHBE 101 Hidden World of Engineering |  |
| NPRE 101 Introduction to Energy Sources |  |
| ABE 128 Applied Biology for Agricultural and Bio |  |
| MSE 101 Materials in Today's World |  |
| IE 445 Human Performance and Cognition in Contex |  |
| CHBE 412 Computational Tools in Chemical Enginee |  |

reason line: "closest to your goal (mechanical engineer): 1st of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · physical therapist

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| HK 264 Applied Medical Terminology for the Healt | HK 340 Social & Psychological Aspects of Physica |
| STAT 212 Biostatistics | PSYC 443 Psychophysiology in Ex & Sport |
| HK 354 Musculoskeletal Anatomy | HK 355 Injuries in Sport |
|  | STAT 212 Biostatistics |

reason line: "closest to your goal (physical therapist): 24th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · journalist

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| JOUR 205 History of American Journalism | JOUR 205 History of American Journalism |
| JOUR 361 Classics of Sports Journalism | JOUR 311 Media Law |
| JOUR 220 News Editing | IS 312 Reading and Writing Data |
| JOUR 311 Media Law | MACS 356 Sex & Gender in Popular Media |
| JOUR 200* Introduction to Journalism | WRIT 303 Writing Across Media |
|  | CW 208 Creative Nonfiction Workshop |
|  | CMN 361 Storytelling as Oral Communication |
|  | IS 357 Introduction to Data Storytelling |
|  | MACS 351 Media Analysis |
|  | ENGL 253 New Media, Literature, and the Arts |
|  | CMN 328 Social Media and Politics |
|  | HIST 207 Digital Documentary Publishing |
|  | LLS 375 Latina/o Media in the US |
|  | PS 312 Politics and the Media |
|  | BTW 360 Writing for Digital Media |
|  | CMN 277* Introduction to Mediated Communication |
|  | MACS 264* Media Industries |
|  | JOUR 200* Introduction to Journalism |

reason line: "closest to your goal (journalist): 16th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · UX designer

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| IS 226 Introduction to HCI | IS 202 Social Aspects Info Tech |
| SE 361 Emotional Intelligence Skills | IS 204 Research Design for Information Sciences |
| GSD 202 Let’s Play: Understanding the Role of Pl | PSYC 358 Human Factors |
| GSD 101 Introduction to Game Studies and Design | BADM 350 IT for Networked Organizations |
| SE 101 Engineering Graphics & Design | SOC 350 Technology and Society |
| IS 236 User Research & Evaluation | HK 203 Introduction to Health Technology |
| DTX 180 Exercising Empathy | JOUR 101 Interactive Media & You |
| BADM 371 User Interaction/User Experience Design | GSD 103 The Basics of Game Design |
| ARTD 218 Interaction Design Foundation | IS 236 User Research & Evaluation |
| ARTD 317 UI/UX Design for Non-Majors | ARTH 211 Design History Survey |
| ARTD 426 Product Innovation | SOCW 220 Technology and Social Issues |
| DTX 221* Human-Centered Design Across Discipline | ARTD 317 UI/UX Design for Non-Majors |
|  | GSD 204 Gender in Gaming |
|  | FAA 102 Design Beyond Boundaries |
|  | ARTD 328 Human-Centered Product Design |
|  | INFO 333 User Experience Design In Action |
|  | ARTD 218 Interaction Design Foundation |
|  | CMN 410 Workplace Comm Technology |
|  | HK 401 Health Behavior and Technology |
|  | DTX 221* Human-Centered Design Across Discipline |

reason line: "closest to your goal (UX designer): 6th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · accountant

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| ACCY 200 Fundamentals of Accounting | BADM 352 Database Design and Management |
| ACCY 312 Principles of Taxation | ACCY 200 Fundamentals of Accounting |
| ACE 346 Tax Policy and Finan Planning | ACCY 312 Principles of Taxation |
|  | ACE 345 Small Business Finance |
|  | ACE 346 Tax Policy and Finan Planning |
|  | FIN 221 Corporate Finance |
|  | BADM 403 Corporate & Commercial Law |
|  | ACCY 451 Advanced Income Tax Problems |

reason line: "closest to your goal (accountant): 32nd of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · veterinarian

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| PSYC 408 Human Behavior Genetics | ANSC 207 The Science of Pets and How to Care for |
| STAT 212 Biostatistics | PSYC 329 Animal Behavior |
| FSHN 120 Contemporary Nutrition | ANSC 255 Animal Ethics |
| FSHN 250 Nutritional Physiology I | STAT 212 Biostatistics |
| CMN 101 Public Speaking | ANTH 361 Ecology and Human Health |
| IB 202 Physiology | CMN 101 Public Speaking |
| HK 154 Physical Activity, Nutrition, and Health |  |

reason line: "closest to your goal (veterinarian): 1st of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · sports management

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| MACS 224 Sportsmedia Technology & Culture | MACS 224 Sportsmedia Technology & Culture |
| JOUR 361 Classics of Sports Journalism | RST 325 Marketing in Recreation, Sport and Touri |
| RST 216 Technology in Recreation, Sport and Tour | HK 355 Injuries in Sport |
| RST 316 Human Development and Recreation, Sport  | JOUR 361 Classics of Sports Journalism |
| RST 354 Legal Aspects of Sport | RST 354 Legal Aspects of Sport |
| RST 100 Recreation, Sport, and Tourism in Modern | HK 242 Intro to Sport Psychology |
| ADV 214 Sports Advertising & Branding | LER 225 Labor Issues in Sports |
| CLCV 250 Sports and Society in Greece and Rome | ADV 214 Sports Advertising & Branding |
| LER 225 Labor Issues in Sports | FSHN 345 Strategic Operations Management |
| JOUR 161 Introduction to Sports Journalism | HIST 390 Sport and Society |
| RST 230* Diversity in Recreation, Sport, and Tou | JOUR 161 Introduction to Sports Journalism |
| RST 335* Leisure and Consumer Culture | LEAD 425 Leading Teams |
|  | RST 230* Diversity in Recreation, Sport, and Tou |
|  | CLCV 250* Sports and Society in Greece and Rome |

reason line: "closest to your goal (sports management): 27th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · public policy

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| ACE 203 Introduction to Public Policy and Law | ECON 210 Environmental Economics & Policy |
| UP 101 Introduction to City Planning | ACE 203 Introduction to Public Policy and Law |
| LLS 368 Latinas/os & Public Policy | UP 211 Local Planning, Gov't and Law |
| PS 321 Principles of Public Policy | HK 272 Aging and Health Policy |
| HDFS 420 Inequality, Public Policy, and U.S. Fam | GLBL 200 Foundations of Research |
| PS 220 Intro to Public Policy | HK 111 Introduction to Public Health |
| HDFS 120* Intro to Family Studies | PS 101 Intro to US Gov & Pol |
| CMN 220* Communicating Public Policy | PS 220 Intro to Public Policy |
|  | PS 321 Principles of Public Policy |
|  | CMN 327 Communication and Public Opinion |
|  | ACE 291 Ag Policy & Leadership |
|  | GWS 272 Women and Politics |
|  | UP 101 Introduction to City Planning |
|  | UP 407 State and Local Public Finance |
|  | RST 225 Environmental Politics & Policy |
|  | LLS 368 Latinas/os & Public Policy |
|  | BADM 449 Business Policy and Strategy |
|  | HDFS 420 Inequality, Public Policy, and U.S. Fam |
|  | HDFS 120* Intro to Family Studies |
|  | CMN 220* Communicating Public Policy |

reason line: "closest to your goal (public policy): 15th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · game developer

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| GSD 202 Let’s Play: Understanding the Role of Pl | IS 205 Programming for Information Problems |
| GSD 101 Introduction to Game Studies and Design | ACE 161 Computer Concepts & Applications |
| GSD 204 Gender in Gaming | GSD 101 Introduction to Game Studies and Design |
| GSD 102 Introduction to the Videogame Industry | GSD 103 The Basics of Game Design |
| IS 142 Social History of Games and Gaming | CS 124 Introduction to Computer Science I |
| THEA 385 Theatrical Tabletop Role-Playing Game D | ADV 200 Data Literacy |
|  | GSD 102 Introduction to the Videogame Industry |
|  | BCOG 200 Introduction to Programming for the Bra |
|  | CI 438 Computer Programming and the Classroom |
|  | IE 405 Computing for ISE |
|  | STAT 447 Data Science Programming Methods |
|  | ACE 360 Spreadsheet Models and Applications |

reason line: "closest to your goal (game developer): 49th of 6,225 Illinois courses by meaning"

## Illinois · Psychology, BSLAS · undecided

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: nothing (no goal)

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## Illinois · Computer Science, BS · dentist

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## Illinois · Computer Science, BS · software engineer

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| CS 477 Formal Software Development Methods | CS 477 Formal Software Development Methods |
| CS 340 Introduction to Computer Systems | CS 423 Operating Systems Design |
| BADM 352 Database Design and Management | CS 340 Introduction to Computer Systems |
| CS 484 Parallel Programming | IS 205 Programming for Information Problems |
| SE 361 Emotional Intelligence Skills | ACE 161 Computer Concepts & Applications |
| CS 483 Applied Parallel Programming |  |
| ECE 364 Programming Methods for Machine Learning |  |
| IS 205 Programming for Information Problems |  |
| ETMA 311* Humanity in the Food Web |  |

reason line: "closest to your goal (software engineer): 5th of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · data scientist

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| STAT 200 Statistical Analysis | MATH 463 Statistics and Probability I |
| HK 209 Introduction to Biostatistics and Health  | BDI 475 Introduction to Data Analytics Applicati |
| BADM 356 Data Science and Analytics | CS 107 Data Science Discovery |
| CS 107 Data Science Discovery | BADM 352 Database Design and Management |
| BIOE 210 Linear Algebra for Biomedical Data Scie | STAT 200 Statistical Analysis |
| STAT 385 Statistics Programming Methods | ATMS 305 Computing and Data Analysis |
| HIST 103* A History of Everything: The Big Bang  | IS 205 Programming for Information Problems |
| GGIS 224* Environmental Data Science | HK 209 Introduction to Biostatistics and Health  |
|  | GGIS 224* Environmental Data Science |

reason line: "closest to your goal (data scientist): 72nd of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · nurse

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| RST 316 Human Development and Recreation, Sport  | HDFS 408 Hospitalized Children |
| PSYC 100 Intro Psych | HK 480 Medical Aspects of Disability |
| SOC 100 Introduction to Sociology | HK 264 Applied Medical Terminology for the Healt |
| HK 206 Health Care Systems | SOC 274 Health, Illness and Society |
| CHEM 102 General Chemistry I | ANSC 207 The Science of Pets and How to Care for |
|  | SOCW 240 Death & Dying |
|  | PHIL 214 Biomedical Ethics |
|  | CPSC 180 Medicinal Plants and Herbology |
|  | GWS 263* History of Medicine in the United State |
|  | RHET 105* Writing and Research |
|  | HDFS 105* Intro to Human Development |

reason line: "closest to your goal (nurse): 23rd of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · lawyer

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| CS 462 Issues of Law and Policy in Computer Scie | LAW 301 Introduction to Law |
| LAW 301 Introduction to Law | LAW 303 Living the Law |
| LAW 303 Living the Law | RST 354 Legal Aspects of Sport |
| ACE 203 Introduction to Public Policy and Law | LAW 307 Law and Literature |
| LAW 307 Law and Literature | PS 370 Justice in the Law |
| LAW 305 Art and Cultural Property Law | JOUR 311 Media Law |
| RST 354 Legal Aspects of Sport | PS 101* Intro to US Gov & Pol |
| AAS 370 Immigration, Law, and Rights |  |

reason line: "closest to your goal (lawyer): 12th of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · financial analyst

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| ACE 240 Personal Financial Planning | FIN 221 Corporate Finance |
| FIN 230 Introduction to Insurance | ACE 240 Personal Financial Planning |
| ACE 349 Risk Management and Financial Planning A | FIN 300 Financial Markets |
| FIN 380 Entrepreneurship through Acquisition | ACE 262 Applied Statistical Methods and Data Ana |
|  | STAT 200 Statistical Analysis |

reason line: "closest to your goal (financial analyst): 1st of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · marketing

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| BADM 360 Digital Marketing | CMN 465 Social Marketing |
| BADM 351 Social Media Strategy | ADV 250 Advertising and Brand Strategy |
| BADM 320 Principles of Marketing | BADM 320 Principles of Marketing |
| ADV 250 Advertising and Brand Strategy | BADM 360 Digital Marketing |
| ADV 301 Becoming an Influencer | BADM 351 Social Media Strategy |
| ACE 335 Food Marketing and Behavior | RST 325 Marketing in Recreation, Sport and Touri |
| TE 466 High-Tech Venture Marketing | ADV 214 Sports Advertising & Branding |
|  | CMN 328 Social Media and Politics |

reason line: "closest to your goal (marketing): 4th of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · teacher

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| EDUC 202 Social Justice, School and Society | SPED 465 Curriculum and Methods in Early Childho |
| EDUC 201 Identity and Difference in Education | HK 260 Teaching Activities I |
| CI 210 Introduction to Digital Learning Environm | EDUC 202 Social Justice, School and Society |
| SPED 117 The Culture of Disability | EDUC 201 Identity and Difference in Education |
| HK 260 Teaching Activities I | EPOL 201 Foundations of Education |
| HK 261 Teaching Activities II | EPOL 380* Education and Social Justice |
|  | EPSY 201* Educational Psychology |

reason line: "closest to your goal (teacher): 1st of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · therapist

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| SOCW 321 Social Entre & Social Change | HK 201 Health Sciences Research Methods |
| SOCW 370 Social Work and Disability Studies | HK 200 Mental Health Issues |
| SOCW 225 Social Work Statistics | PSYC 301 Psychological Statistics |
| PSYC 339 Restorative Justice: Principles and Met | SOC 274 Health, Illness and Society |
| PSYC 230 Perception & Sensory Processes | SOCW 200 Introduction to Social Work |
| SOCW 380 Current Topics in Social Work | HIST 236* Madness and Modern Society |
| SOCW 297* Asian Families in America | EPSY 201* Educational Psychology |
| PSYC 236* Madness and Modern Society |  |
| SOCW 200* Introduction to Social Work |  |

reason line: "closest to your goal (therapist): 26th of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · environmental scientist

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| ANTH 278 Climate Change & Civilization | HK 408 Environmental Health |
| ATMS 202 General Physical Climate | ESE 311 Environmental Issues Today |
| ANTH 361 Ecology and Human Health | ACE 210 Environmental Economics & Policy |
| ENVS 210 Environmental Economics & Policy | NRES 219 Applied Ecology |
| UP 205 Ecology & Environmental Sustainability | UP 205 Ecology & Environmental Sustainability |
| NRES 224 Environmental and Climate Justice | ESE 287 Environment and Society |
| LA 480 Sustainable Design Principles | HIST 202 American Environmental History |
| ESE 106* Geographies of Globalization | RST 225 Environmental Politics & Policy |
| ESE 202* American Environmental History |  |
| ESE 210* Social & Environmental Issues |  |

reason line: "closest to your goal (environmental scientist): 5th of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · mechanical engineer

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| SE 361 Emotional Intelligence Skills | TAM 201 Mechanics for Technol & Mgmt |
| NPRE 330 Materials in Nuclear Engineering | NPRE 330 Materials in Nuclear Engineering |
| SE 101 Engineering Graphics & Design | CEE 201 Systems Engrg & Economics |
| ECE 364 Programming Methods for Machine Learning | SE 261 Business Side of Engineering |
| ECE 205 Electrical and Electronic Circuits |  |
| TAM 211 Statics |  |
| ME 200 Thermodynamics |  |

reason line: "closest to your goal (mechanical engineer): 1st of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · physical therapist

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## Illinois · Computer Science, BS · journalist

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| JOUR 200 Introduction to Journalism | JOUR 200 Introduction to Journalism |
| JOUR 205 History of American Journalism | JOUR 361 Classics of Sports Journalism |
| JOUR 220 News Editing | IS 312 Reading and Writing Data |
| JOUR 102 Navigating Social Media | MACS 356 Sex & Gender in Popular Media |
|  | WRIT 303 Writing Across Media |
|  | JOUR 205 History of American Journalism |
|  | CMN 277* Introduction to Mediated Communication |
|  | MACS 264* Media Industries |
|  | MACS 351* Media Analysis |

reason line: "closest to your goal (journalist): 35th of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · UX designer

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| IS 226 Introduction to HCI | IS 202 Social Aspects Info Tech |
| GSD 202 Let’s Play: Understanding the Role of Pl | BADM 350 IT for Networked Organizations |
| DTX 221 Human-Centered Design Across Disciplines | IS 204 Research Design for Information Sciences |
| GSD 101 Introduction to Game Studies and Design | SOC 350 Technology and Society |
| IS 236 User Research & Evaluation | HK 203 Introduction to Health Technology |
|  | IS 226 Introduction to HCI |
|  | DTX 221* Human-Centered Design Across Discipline |
|  | JOUR 101* Interactive Media & You |

reason line: "closest to your goal (UX designer): 6th of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · accountant

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| ECON 103* Macroeconomic Principles | BADM 352 Database Design and Management |
|  | FIN 221 Corporate Finance |
|  | ACCY 200 Fundamentals of Accounting |
|  | ECON 103* Macroeconomic Principles |

reason line: "closest to your goal (accountant): 32nd of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · veterinarian

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## Illinois · Computer Science, BS · sports management

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| JOUR 361 Classics of Sports Journalism | MACS 224 Sportsmedia Technology & Culture |
| MACS 224 Sportsmedia Technology & Culture | HK 355 Injuries in Sport |
| RST 216 Technology in Recreation, Sport and Tour | HK 242 Intro to Sport Psychology |
| RST 316 Human Development and Recreation, Sport  | LER 225 Labor Issues in Sports |
| RST 354 Legal Aspects of Sport | JOUR 361 Classics of Sports Journalism |
| RST 100 Recreation, Sport, and Tourism in Modern | RST 230* Diversity in Recreation, Sport, and Tou |
| RST 335* Leisure and Consumer Culture | CLCV 250* Sports and Society in Greece and Rome |
| CLCV 250* Sports and Society in Greece and Rome | RST 100* Recreation, Sport, and Tourism in Moder |
|  | RST 120* Parks, Recreation, and Environments |

reason line: "closest to your goal (sports management): 27th of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · public policy

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| ACE 203 Introduction to Public Policy and Law | UP 407 State and Local Public Finance |
| PS 220 Intro to Public Policy | ACE 203 Introduction to Public Policy and Law |
| UP 101 Introduction to City Planning | ECON 210 Environmental Economics & Policy |
| HDFS 120* Intro to Family Studies | HK 272 Aging and Health Policy |
| PS 100* Intro to Political Science | GLBL 200 Foundations of Research |
|  | UP 211 Local Planning, Gov't and Law |
|  | PS 101 Intro to US Gov & Pol |
|  | HDFS 120* Intro to Family Studies |
|  | HK 111* Introduction to Public Health |

reason line: "closest to your goal (public policy): 8th of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · game developer

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| GSD 101 Introduction to Game Studies and Design | CS 423 Operating Systems Design |
| GSD 202 Let’s Play: Understanding the Role of Pl | CS 422 Programming Language Design |
| GSD 204 Gender in Gaming | CS 340 Introduction to Computer Systems |
| IS 142 Social History of Games and Gaming | IS 205 Programming for Information Problems |
| GSD 102 Introduction to the Videogame Industry | ACE 161 Computer Concepts & Applications |
|  | GSD 101 Introduction to Game Studies and Design |
|  | ACE 360 Spreadsheet Models and Applications |

reason line: "closest to your goal (game developer): 25th of 6,225 Illinois courses by meaning"

## Illinois · Computer Science, BS · undecided

degree: unmet 2 -> 2, not placed 0 -> 0; the matcher ranked: nothing (no goal)

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## UGA · Computer Science BS · dentist

degree: unmet 4 -> 4, not placed 2 -> 2; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
|  | BIOL 2900 Clinical Applications of Biological Sc |
|  | VPAT 3900 Current Topics in One Health |

reason line: "closest to your goal (dentist): 10th of 7,322 UGA courses by meaning"

## UGA · Computer Science BS · software engineer

degree: unmet 4 -> 4, not placed 3 -> 3; the matcher ranked: electives

| words (today) | meaning (career matcher) |
|---|---|
| AENG 2920 Engineering Design Methodology |  |
| BUSN 3020E Structured Query Language (SQL) Skill |  |

## UGA · Computer Science BS · data scientist

degree: unmet 7 -> 7, not placed 4 -> 4; the matcher ranked: electives

| words (today) | meaning (career matcher) |
|---|---|
| BUSN 3040E R Programming Skills for Business Ana | BUSN 3040E R Programming Skills for Business Ana |

reason line: "closest to your goal (data scientist): 27th of 7,322 UGA courses by meaning"

## UGA · Computer Science BS · nurse

degree: unmet 4 -> 4, not placed 2 -> 2; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
|  | VPAT 3900 Current Topics in One Health |
|  | BIOL 2900 Clinical Applications of Biological Sc |

reason line: "closest to your goal (nurse): 11th of 7,322 UGA courses by meaning"

## UGA · Computer Science BS · lawyer

degree: unmet 3 -> 3, not placed 1 -> 1; the matcher ranked: electives

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## UGA · Computer Science BS · financial analyst

degree: unmet 4 -> 4, not placed 2 -> 2; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## UGA · Computer Science BS · marketing

degree: unmet 4 -> 4, not placed 2 -> 2; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## UGA · Computer Science BS · teacher

degree: unmet 4 -> 4, not placed 2 -> 2; the matcher ranked: electives

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## UGA · Computer Science BS · therapist

degree: unmet 4 -> 4, not placed 2 -> 2; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
|  | JURI 3627 Mental Health Law |

reason line: "closest to your goal (therapist): 9th of 7,322 UGA courses by meaning"

## UGA · Computer Science BS · environmental scientist

degree: unmet 2 -> 2, not placed 2 -> 2; the matcher ranked: electives

| words (today) | meaning (career matcher) |
|---|---|
| IDIS 3120 Special Topics in Vector Ecology and V | EETH 4020 Readings in Environmental Ethics |
| ALDR 3800S Scotland Service-Learning Project: Ad |  |
| EETH 4190 Agricultural Ethics |  |

reason line: "closest to your goal (environmental scientist): 41st of 7,322 UGA courses by meaning"

## UGA · Computer Science BS · mechanical engineer

degree: unmet 3 -> 3, not placed 2 -> 2; the matcher ranked: electives

| words (today) | meaning (career matcher) |
|---|---|
| AENG 2920 Engineering Design Methodology | AENG 2920 Engineering Design Methodology |

reason line: "closest to your goal (mechanical engineer): 35th of 7,322 UGA courses by meaning"

## UGA · Computer Science BS · physical therapist

degree: unmet 4 -> 4, not placed 2 -> 2; the matcher ranked: electives

| words (today) | meaning (career matcher) |
|---|---|
| BUSN 3040E R Programming Skills for Business Ana |  |

## UGA · Computer Science BS · journalist

degree: unmet 7 -> 7, not placed 1 -> 1; the matcher ranked: electives

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## UGA · Computer Science BS · UX designer

degree: unmet 4 -> 4, not placed 2 -> 2; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
|  | AENG 2920 Engineering Design Methodology |

reason line: "closest to your goal (UX designer): 12th of 7,322 UGA courses by meaning"

## UGA · Computer Science BS · accountant

degree: unmet 4 -> 4, not placed 2 -> 2; the matcher ranked: electives

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## UGA · Computer Science BS · veterinarian

degree: unmet 4 -> 4, not placed 2 -> 2; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
|  | BIOL 2900 Clinical Applications of Biological Sc |

reason line: "closest to your goal (veterinarian): 12th of 7,322 UGA courses by meaning"

## UGA · Computer Science BS · sports management

degree: unmet 4 -> 4, not placed 2 -> 2; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| ATTR 3100L Prevention and Care of Conditions in  | ATTR 3100L Prevention and Care of Conditions in  |

reason line: "closest to your goal (sports management): 43rd of 7,322 UGA courses by meaning"

## UGA · Computer Science BS · public policy

degree: unmet 4 -> 4, not placed 2 -> 2; the matcher ranked: electives

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## UGA · Computer Science BS · game developer

degree: unmet 2 -> 2, not placed 1 -> 1; the matcher ranked: electives

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## UGA · Computer Science BS · undecided

degree: unmet 4 -> 4, not placed 2 -> 2; the matcher ranked: nothing (no goal)

| words (today) | meaning (career matcher) |
|---|---|
|  |  |

## UGA · Psychology BS · dentist

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
|  | BIOL 4200W Science and Health Writing |
|  | LAMS 2000E Preparing for Healthcare |
|  | ANTH 2020 Introduction to Forensic Anthropology |
|  | CHEM 1211 General Chemistry I |
|  | MIBO 3000 Introductory Applied Microbiology |
|  | BIOL 2900 Clinical Applications of Biological Sc |
|  | VPAT 3900 Current Topics in One Health |
|  | BIOL 4910 Advanced Topics in Biology |

reason line: "closest to your goal (dentist): 41st of 7,322 UGA courses by meaning"

## UGA · Psychology BS · software engineer

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| MATH 4690 Graph Theory | ELEE 2040 Programming for Engineers |
| ELEE 2040 Programming for Engineers | CSEE 2210 Introduction to Computer Systems Engin |
| PHYS 2001 Introduction to Scientific Programming | AENG 2100 Principles of Systems Engineering |
| LING 2200 Python Programming for Language and Li | ENGG 2146 Computational Engineering Methods III |
| CSCI 2150 Introduction to Computational Science | NMIX 4010 Web Development |
| BUSN 3020E Structured Query Language (SQL) Skill |  |

reason line: "closest to your goal (software engineer): 6th of 7,322 UGA courses by meaning"

## UGA · Psychology BS · data scientist

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| BIOL 4200W Science and Health Writing | ECOL 2550 Introduction to Ecological Data Scienc |
| PHYS 2001 Introduction to Scientific Programming | STAT 2010 Statistical Methods for Data Scientist |
| ECOL 2550 Introduction to Ecological Data Scienc | MIST 2090 Introduction to Information Systems in |
| BIOS 3000 Intermediate Biostatistics for Public  | STAT 2360 Programming and Data Literacy Using R |
| DIGI 3500 Data Fluency | DIGI 3500 Data Fluency |
| JURI 2990 Law, Justice, and the State | BUSN 3040E R Programming Skills for Business Ana |

reason line: "closest to your goal (data scientist): 18th of 7,322 UGA courses by meaning"

## UGA · Psychology BS · nurse

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| BIOL 3990 Seminar in the Practice of Medicine | BIOL 3990 Seminar in the Practice of Medicine |
| HDFS 2300 Research Unlocked: Skills for Understa | NUTR 2400 Preparing for Careers in Science, Medi |
| MIBO 2500 Microbiology and Health Care | GRNT 3030 Medical Care of Older Adults |
| ANTH 3540 Multicultural Health Care | ANTH 3540 Multicultural Health Care |
| ETES 3100 Technical Field Theory | BIOL 4200W Science and Health Writing |
| ECHD 3020 Introduction to Counseling and Human D | PHIL 3220 Biomedical Ethics |
|  | HIST 3433 History of Medicine |
|  | BIOL 2900 Clinical Applications of Biological Sc |
|  | VPAT 3900 Current Topics in One Health |

reason line: "closest to your goal (nurse): 16th of 7,322 UGA courses by meaning"

## UGA · Psychology BS · lawyer

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| HIST 3775 Crime, Punishment, and Human Rights | JURI 3595 Studies in Law in Other Times and Plac |
| JURI 3233 Foundations of American Law | LEGL 2700E Legal and Regulatory Environment of B |
| LEGL 2700 Legal and Regulatory Environment of Bu | ENGL 3335 Literature and Law |
| POLS 3600 Criminal Justice Administration | EDAP 4170 Education Law and Professional Ethics |
| ENGL 3335 Literature and Law | HIST 4060 American Legal History |
| INTL 3200 Introduction to International Relation | COMM 4330 Communication Strategies in the Courtr |

reason line: "closest to your goal (lawyer): 15th of 7,322 UGA courses by meaning"

## UGA · Psychology BS · financial analyst

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| FHCE 3250 Survey of Financial Planning | FHCE 3250 Survey of Financial Planning |
| HFIM 2500 Introduction to Hospitality and Food I | ACCT 2101 Principles of Accounting I |
| ACCT 1160 Survey of Accounting | FINA 3001 Financial Management |
| JURI 3080E Life Cycle of a Corporation | BUSN 1990 Introduction to Markets and Enterprise |
| BUSN 1990 Introduction to Markets and Enterprise | LEGL 4700 FinTech and Financial Services Law |
| FINA 3001 Financial Management | ADPR 3870 Introduction to Corporate Communicatio |
|  | MBUS 3755 Economic and Financial Fundamentals Ap |

reason line: "closest to your goal (financial analyst): 5th of 7,322 UGA courses by meaning"

## UGA · Psychology BS · marketing

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| AGCM 3820 Branding and Marketing For Agricultura | MARK 3001 Principles of Marketing |
| HFIM 2500 Introduction to Hospitality and Food I | AGCM 3820 Branding and Marketing For Agricultura |
| ENGL 3430 Literature and Childhood | ADPR 3100 Principles of Advertising |
| ADPR 3100 Principles of Advertising | COMM 3700 Empirical Research Methods in Communic |
| MBUS 3000 Business Fundamentals as Applied to th | HPRB 3050S Service-Learning in Health Promotion |
| MCHE 2990 Engineered Systems in Society | PHRM 4750 Pharmaceutical and Health Care Marketi |
| HPRB 3210 Issues in Health Consumerism and Self- |  |

reason line: "closest to your goal (marketing): 14th of 7,322 UGA courses by meaning"

## UGA · Psychology BS · teacher

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| EDUC 2110 Investigating Critical and Contemporar | LLED 3461S Service-Learning in Teacher Education |
| MATH 2001 Geometry for Elementary School Teacher | EMAT 2000 Foundations of Mathematics Education |
| EDIT 2000 Teaching and Learning with Technology | KINS 3120 Teaching of Striking/Target Activities |
| EDUC 2120 Exploring Socio-Cultural Perspectives  | EPSY 3200 Child Development and Teaching in the  |
| ADSC 2700 Animal Science Education and Youth Liv | EDIT 2000 Teaching and Learning with Technology |
| LLED 3400 Current Issues in Secondary English Ed | EDUC 2110 Investigating Critical and Contemporar |
| MBUS 3010 Introduction to Music Business | EDEL 4040 Special Topics in Elementary Education |

reason line: "closest to your goal (teacher): 1st of 7,322 UGA courses by meaning"

## UGA · Psychology BS · therapist

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| PSYC 3230 Psychopathology | PSYC 3810 Psychology of Health |
| KINS 2500 Exercise is Medicine | HPRB 1710 Health and Wellness |
| PSYC 3250 The Psychology of Intimate Relationshi | HDFS 3100 Introduction to Behavioral Health |
| PSYC 3300 Social and Personality Development | ECHD 3020 Introduction to Counseling and Human D |
| PSYC 4600 Psychology of Women | PSYC 4600 Psychology of Women |
| ADPR 3570 Podcast Branding and Production | PSYC 4920 History of Psychology |
| JURI 3360 The Death Penalty in America | ANTH 3540 Multicultural Health Care |

reason line: "closest to your goal (therapist): 2nd of 7,322 UGA courses by meaning"

## UGA · Psychology BS · environmental scientist

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| GEOG 3180 Global Climate Change: Causes and Cons | EHSC 3060 Introduction to Environmental Health S |
| ENVE 2610 Introduction to Environmental Engineer | ENVE 2610 Introduction to Environmental Engineer |
| ECOL 3180 Neotropical Ecology, Conservation, and | COMM 3320 Environmental Communication |
| BIOL 4200W Science and Health Writing | BIOL 4200W Science and Health Writing |
| GEOL 3030 Elementary Oceanography | GEOG 3180 Global Climate Change: Causes and Cons |
| ALDR 3800S Scotland Service-Learning Project: Ad | HIST 3160 American Environmental History |

reason line: "closest to your goal (environmental scientist): 4th of 7,322 UGA courses by meaning"

## UGA · Psychology BS · mechanical engineer

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| ENGG 2146 Computational Engineering Methods III | MCHE 2990 Engineered Systems in Society |
| ARST 3850 Interactive Art I | AERO 2990 Aerospace Systems Engineering |
| ENVE 2610 Introduction to Environmental Engineer | MATH 2250 Calculus I for Science and Engineering |
| AENG 2100 Principles of Systems Engineering | HIST 3425 History of Engineering |
|  | AENG 2920 Engineering Design Methodology |

reason line: "closest to your goal (mechanical engineer): 24th of 7,322 UGA courses by meaning"

## UGA · Psychology BS · physical therapist

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| HIST 3775 Crime, Punishment, and Human Rights | KINS 2100 Prevention and Care of Athletic Injuri |
| NUTR 2100 Fundamentals of Human Nutrition | PEDB 1010 Adapted Physical Education |
| KINS 2500 Exercise is Medicine | NUTR 2050 Introduction to Sport Nutrition and We |
| ARST 1050 Drawing I: Observation and Visual Lang | RBIO 2010 Introductory Regenerative Bioscience |
| PHRM 3470 Pathophysiology I | LAMS 3020E Foundations of Clinical Medicine III |
| DANC 2060 Aerial Yoga Trapeze I | HPRB 3750 Foundations of Injury Prevention |
|  | ATTR 3100 Prevention and Care of Conditions in S |
|  | DANC 2020 Practicing Wellness |

reason line: "closest to your goal (physical therapist): 3rd of 7,322 UGA courses by meaning"

## UGA · Psychology BS · journalist

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| BIOL 4300W Scientific Research Writing | BIOL 4200W Science and Health Writing |
| EMST 3012E The Peabody Archive and Genre Televis | FHCE 2010 Introduction to Consumer Journalism |
| COMM 2520 Introduction to Interviewing | ENGL 3540 Introduction to Publishing |
| HIST 3777 History Behind the Headlines | NMIX 2010 Introduction to New Media |
| JRLC 3600 Media Savvy Becoming Digitally Literat | JRLC 3600 Media Savvy Becoming Digitally Literat |
| JURI 3200S Law and Social Justice:  Strategic Ad | ADPR 3535 Advertising Copywriting |
|  | SPTM 3850 Introduction to Sports Reporting and W |
|  | UNIV 2115 Digital Literacies and Documentary Med |

reason line: "closest to your goal (journalist): 80th of 7,322 UGA courses by meaning"

## UGA · Psychology BS · UX designer

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| THEA 3300 Foundations of Performance Design | THEA 3700 Design for Film and Television |
| TXMI 3230 Popular Culture and Fashion | ENGR 1120E Engineering Graphics and Design |
| ARGD 3010 Foundations of Graphic Design | MCHE 2990 Engineered Systems in Society |
| ENGL 3540 Introduction to Publishing | CSEE 2920 Computer Systems Engineering Design Me |
|  | HPRB 3350 Health and Technology |
|  | TXMI 3540 CAD for Apparel Design and Production |
|  | ARGD 3010 Foundations of Graphic Design |
|  | AENG 2920 Engineering Design Methodology |

reason line: "closest to your goal (UX designer): 18th of 7,322 UGA courses by meaning"

## UGA · Psychology BS · accountant

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| CMLT 3600 Gods, Ghosts, and Demons in East Asian | ACCT 2101 Principles of Accounting I |
| ACCT 2101 Principles of Accounting I | LEGL 2700 Legal and Regulatory Environment of Bu |
| FHCE 3250 Survey of Financial Planning | FHCE 3250 Survey of Financial Planning |
| TXMI 3240 Retail Planning and Buying | MIST 2090 Introduction to Information Systems in |
| THEA 3600 Fundamentals of Acting on Camera | JURI 3355 Criminal Legal System Through Crime Bo |
| BIOL 3900 Readings in Biology | HIST 4765 Museum Registration Methods |
|  | MBUS 3755 Economic and Financial Fundamentals Ap |

reason line: "closest to your goal (accountant): 5th of 7,322 UGA courses by meaning"

## UGA · Psychology BS · veterinarian

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| PSYC 4120 Sensation and Perception | BIOL 3910 Topics in Biology |
| ANTH 2800 Food, Environment, and Culture | ADSC 2010 Introductory Animal and Dairy Science |
| BIOL 1108 Principles of Biology II | VPAT 3101 Basic Veterinary Medical Terminology |
| CBIO 3050 Medical Histology | POPH 3300 Introduction to Wildlife Health |
| POUL 3000 Avian Surgical Techniques | IDIS 3110 Food Animal Infectious Diseases |
|  | MIBO 2500 Microbiology and Health Care |
|  | WMST 2500 Introduction to Gender, Women, and Hea |
|  | BIOL 2900 Clinical Applications of Biological Sc |

reason line: "closest to your goal (veterinarian): 23rd of 7,322 UGA courses by meaning"

## UGA · Psychology BS · sports management

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| HIPR 2200 Sports Heritage | KINS 3510 Group Exercise Instruction |
| THEA 2140 Athletes and Artists: The Drama of Spo | THEA 2140 Athletes and Artists: The Drama of Spo |
| PHIL 3300 Philosophy of Sports and Games | ATTR 3100 Prevention and Care of Conditions in S |
| KINS 3510 Group Exercise Instruction | HIPR 2200 Sports Heritage |
| HIST 3755 The History of Sport | PHIL 3300 Philosophy of Sports and Games |
| SOCI 3005 Race, Technology, and the Body | HIST 3755 The History of Sport |
| ATTR 3100 Prevention and Care of Conditions in S | ENGL 3570 Games and Culture |

reason line: "closest to your goal (sports management): 38th of 7,322 UGA courses by meaning"

## UGA · Psychology BS · public policy

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| ADPR 3860 Introduction to Public Affairs Communi | PADP 3100 Introduction to Policy Analysis |
| COMM 1300 Introduction to Academic Debate | AAEC 2580 Applied Microeconomic Principles |
| ENGR 3620 Introduction to E-Mobility | HPAM 3600 Introduction to Health Policy |
| GRNT 3150 Global Aging | ADPR 3860 Introduction to Public Affairs Communi |
| HPAM 3600 Introduction to Health Policy | POLS 3010 Political Ideologies |
| PADP 2200 Hot Topics in Public Administration an | PBHL 3100E Introduction to Public Health |
|  | HIST 4722 The People Behind Public Policy |

reason line: "closest to your goal (public policy): 1st of 7,322 UGA courses by meaning"

## UGA · Psychology BS · game developer

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: all

| words (today) | meaning (career matcher) |
|---|---|
| ENGL 3560W Writing Games | CSEE 2920 Computer Systems Engineering Design Me |
| PHIL 3300 Philosophy of Sports and Games | ENGL 3560W Writing Games |
| EPID 2100 Health Data Literacy for Public Health | ELEE 2040 Programming for Engineers |
| HIST 3727 History of Computing, the Internet, an | AENG 2100 Principles of Systems Engineering |
| PRTM 1100E Introduction to Travel and Tourism | NMIX 4010 Web Development |

reason line: "closest to your goal (game developer): 10th of 7,322 UGA courses by meaning"

## UGA · Psychology BS · undecided

degree: unmet 1 -> 1, not placed 0 -> 0; the matcher ranked: nothing (no goal)

| words (today) | meaning (career matcher) |
|---|---|
|  |  |
